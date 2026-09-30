// The chat's language model (Google Gemini), called from the browser. The
// site never names it: to the user it is simply Localio's assistant.
//
// Gemini never sees the internet or its own memory of Pune. For every
// question, the built-in engine (chat.js) works out what's being asked and
// computes the answer from the ward data; this file hands Gemini those
// facts — the plan, how the score works, the current top 5, full cards for
// the wards in question and the engine's own result — and asks it to
// answer only from them. Ward names it returns are checked against the
// data, and anything that fails (no key, rate limit, a busy model, a bad
// reply) falls back to the built-in answer.

import { parsePlan } from "./chat.js";
import { CATEGORIES, rupees } from "./format.js";
import { AREAS, briefName, COMPONENTS, competitionLevel, monthlyRent, parts, rank, roundedParts } from "./score.js";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Fast first; the larger model only if the first is busy.
const MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash"];
const TIMEOUT_MS = 20_000;
const PER_MINUTE = 8;
const HISTORY = 4;

const INSTRUCTIONS = `You are Localio's assistant. You help people decide where in Pune to open a cafe or a QSR
(quick-service restaurant), using Localio's data on Pune's 140 electoral wards.

Rules:
- Answer only from the FACTS in the latest message. Never invent a number, ward, rent, place or source.
- If the facts don't cover the question, say so briefly and suggest what you can answer.
- If the question isn't about opening a cafe or QSR in Pune, or about Localio, decline in one sentence.
- Scores are out of 100 and add up four parts: residents, eating out, daytime draw and low competition.
  Explain a score with its parts when that helps.
- Rent figures are guides from published rents, not quotes. The data can't forecast sales or profit.
- Use figures exactly as given; don't recalculate them. Write money like ₹31k or ₹1.2L.
- If the question implies a different plan (size, area, budget, what matters), use the facts for that plan.
- Be concise and plain: at most 4 short sentences, or a short list of up to 5 lines. No markdown headings.
- In "wards", list the exact names of the wards your answer mentions, spelled as in the facts.
- You are Localio's assistant. Never name the AI model or company behind you; if asked, say you're
  Localio's assistant and answer from its ward data.`;

const SCHEMA = {
  type: "OBJECT",
  properties: { answer: { type: "STRING" }, wards: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["answer", "wards"],
};

const recent = [];

// { answer, wards, model } from Gemini, or null to use the built-in answer.
export async function askGemini(question, context, builtIn, { key, history = [] }) {
  if (!key) return null;
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= PER_MINUTE) return null;
  recent.push(now);

  const contents = [
    ...history.slice(-HISTORY * 2).map((m) => ({ role: m.role === "user" ? "user" : "model", parts: [{ text: m.text }] })),
    { role: "user", parts: [{ text: `FACTS\n${facts(question, context, builtIn)}\n\nQUESTION\n${question}` }] },
  ];
  for (const model of MODELS) {
    const reply = await call(model, key, contents);
    if (reply === "retry") continue;
    if (!reply) return null;
    const known = new Map(context.wards.map((w) => [w.properties.name.toLowerCase(), w]));
    const wards = [...new Set(reply.wards)].map((name) => known.get(String(name).toLowerCase())).filter(Boolean);
    return { answer: reply.answer, wards, model };
  }
  return null;
}

// One model, one try. "retry" means busy or rate-limited: try the next.
async function call(model, key, contents) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
        contents,
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 700,
          responseMimeType: "application/json",
          responseSchema: SCHEMA,
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      }),
    });
    if ([429, 500, 503].includes(response.status)) return "retry";
    if (!response.ok) return null;
    const body = await response.json();
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const reply = JSON.parse(text);
    if (typeof reply.answer !== "string" || !reply.answer.trim() || !Array.isArray(reply.wards)) return null;
    return { answer: reply.answer.trim(), wards: reply.wards };
  } catch (error) {
    return error.name === "AbortError" ? "retry" : null;
  } finally {
    clearTimeout(timer);
  }
}

// Everything Gemini may use, as plain text built from the ward data. The
// facts are for the plan the question implies ("near colleges", "400 sq
// ft"), so Gemini never has to adjust a figure itself.
export function facts(question, context, builtIn) {
  const { wards, meta, rent, plan: current } = context;
  const { asked, plan } = parsePlan(question, current);
  const ranking = Object.keys(asked).length ? rank(wards, plan, rent) : context.ranking;
  const c = CATEGORIES[plan.category];
  const reference = meta.score.reference_per_10k[plan.category];
  const focus = [...builtIn.wards];
  for (const { feature } of ranking.slice(0, 5)) if (!focus.includes(feature)) focus.push(feature);

  const lines = [
    `The user's plan on the map: ${describe(current)}.`,
    Object.keys(asked).length ? `This question implies: ${describe(plan)}. The facts below are for that plan.` : "",
    "",
    "How the score works: each of the four parts is 0 to 1. Residents, eating out and daytime draw are the ward's "
      + "standing among Pune's 140 wards on residents per km², food and drink places per km², and offices, colleges and "
      + `stations per km². Low competition is 1 − x/(x + ${reference.toFixed(2)}), where x is the ward's ${c.many} per 10,000 `
      + `residents (plus one, since OpenStreetMap misses outlets) and ${reference.toFixed(2)} is the rate in well-mapped `
      + "wards. Score = 100 × Σ(weight × part) / Σ(weights). Wards with under "
      + `${meta.min_outlets} outlets mapped are low confidence and left off the shortlist unless the user includes them.`,
    `Rent = ₹${rent.typical_psf} per sq ft a month (median of ${rent.listings} Pune listings) × the ward's tier `
      + "(from Cushman & Wakefield high-street rents) × shop size. Healthy rent is "
      + `${Math.round(rent.healthy_share[0] * 100)}–${Math.round(rent.healthy_share[1] * 100)}% of sales.`,
    `Pune overall: ${meta.outlets} food and drink outlets mapped, ${meta.category_counts.cafe} cafes, `
      + `${meta.category_counts.fast_food} QSRs.`,
    "",
    `Top 5 for this plan: ${ranking.length ? ranking.slice(0, 5).map(({ feature, score }, i) =>
      `${i + 1}. ${feature.properties.name} ${Math.round(score)}/100`).join("; ") : "no ward fits"}.`,
    "",
    "Wards:",
    ...focus.slice(0, 8).map((ward) => card(ward, plan, rent, reference, ranking)),
    "",
    `Localio's built-in answer to this question (${builtIn.kind}): ${builtIn.text}`
      + (builtIn.list?.length ? ` ${builtIn.list.join(" | ")}` : ""),
  ];
  return lines.join("\n");
}

function describe(plan) {
  const shares = parts({ components: { residents: 0, eating_out: 0, daytime: 0 }, categories: { [plan.category]: { room: 0 } } },
    plan.category, plan.weights).items;
  return `a ${CATEGORIES[plan.category].one}, ${AREAS[plan.area]}, a ${plan.sqft} sq ft shop`
    + `${plan.budget ? `, rent budget ${rupees(plan.budget)} a month` : ""}; customers and competition: `
    + `${briefName(plan.weights)} (weights ` + shares.map((s) => `${s.label.toLowerCase()} ${Math.round(s.share * 100)}%`).join(", ") + ")";
}

function card(ward, plan, rent, reference, ranking) {
  const p = ward.properties;
  const c = CATEGORIES[plan.category];
  const score = parts(p, plan.category, plan.weights);
  const points = roundedParts(score.items);
  const position = ranking.findIndex((r) => r.feature === ward);
  const stats = p.categories[plan.category];
  const top = Object.entries(p.menu).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([kind, share]) => `${kind.toLowerCase()} ${Math.round(share * 100)}%`).join(", ");
  return `- ${p.name} (${p.corporation} ward ${p.ward_number}${p.aliases.length ? `; includes ${p.aliases.slice(0, 4).join(", ")}` : ""}): `
    + `score ${Math.round(score.total)}/100 for a ${c.one} = `
    + COMPONENTS.map((comp, i) => `${comp.label.toLowerCase()} ${points[i]}`).join(" + ")
    + `${position >= 0 ? `; #${position + 1} for this plan` : "; not in this plan's list"}. `
    + `${p.population.toLocaleString("en-US")} residents (${p.residents_per_km2.toLocaleString("en-US")} per km²); `
    + `${p.total_pois} food and drink outlets (${p.outlets_per_km2} per km²); `
    + `${p.draws.offices} offices, ${p.draws.colleges} colleges, ${p.draws.stations} stations; `
    + `${p.categories.cafe.count} cafes (${p.categories.cafe.per_10k} per 10k), ${p.categories.fast_food.count} QSRs `
    + `(${p.categories.fast_food.per_10k} per 10k); ${c.one} competition ${competitionLevel(p, plan.category, reference)} `
    + `(${stats.per_10k} per 10k vs ${reference.toFixed(2)}). Rent ₹${monthlyRent(rent, p, plan.sqft).toLocaleString("en-IN")} a month for `
    + `${plan.sqft} sq ft, ${p.rent.tier} tier${p.rent.estimated ? " (estimated)" : ""}. `
    + `${top ? `Menus: ${top}. ` : ""}${p.status === "scored" ? "" : "LOW CONFIDENCE: few outlets mapped. "}`
    + `Localio's note: ${p.recommendation}`;
}
