// The chat: answers questions about opening a cafe or QSR in Pune from the
// ward data, in the browser, and only from it. There is no language model:
// each answer is built from the same numbers as the map, names the wards
// it used, and anything off-topic is refused rather than guessed.
//
// reply(question, context) -> { kind, text, list?, wards, plan? }
//   kind   what was understood: ward, compare, why, rent, ranking, gap,
//          cheapest, method, stats, help or refuse
//   text   the answer; list: optional lines under it
//   wards  the ward features the answer relies on (shown as chips)
//   plan   a plan the question asked for, if it differs from the current one

import { CATEGORIES, rupees } from "./format.js";
import { AREAS, breakdown, competitionLevel, LENSES, monthlyRent, rank } from "./score.js";

// A question must mention a ward or one of these to be in scope.
const DOMAIN = /\b(caf[eé]s?|coffee|chai|tea|bakery|bakeries|desserts?|qsrs?|quick[- ]service|fast[- ]food|burgers?|pizzas?|momos?|restaurants?|food|eat|eating|outlets?|shops?|stalls?|rents?|footfall|busy|busyness|competitors?|competition|wards?|localit(y|ies)|neighbou?rhoods?|areas?|scores?|ranks?|ranked|shortlist|localio|pcmc|pmc)\b/i;
const FORMATS = {
  fast_food: /\b(qsrs?|quick[- ]service|fast[- ]food|burgers?|pizzas?|momos?|rolls?|sandwich(es)?|shawarma)\b/i,
  cafe: /\b(caf[eé]s?|coffee|chai|tea|bakery|bakeries|desserts?|ice[- ]cream)\b/i,
};
const LENS_WORDS = [
  ["quiet", /\b(competition|competitors?|fewest|least|unmet|under[- ]?served|gaps?|untapped|room|quiet|saturat\w*)\b/i],
  ["busy", /\b(busy|busiest|footfall|crowds|traffic|popular|demand|lively)\b/i],
  ["balanced", /\bbalanced?\b/i],
];
// "PCMC 56" is part of a ward's name, not the area.
const AREA_WORDS = [
  ["pcmc", /\b(pcmc(?!\s*\d)|pimpri[- ]chinchwad)\b/i],
  ["pmc", /\b(pmc(?!\s*\d)|pune city|pune municipal)\b/i],
];
const BUDGET = /\b(?:under|below|less than|within|max(?:imum)?|up ?to|upto|budget(?: of| is)?|at most)\s*(?:₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|l|lakhs?|lacs?)?\b/i;
const SIZE = /\b(\d{2,5})\s*(?:sq\.?\s*ft|sqft|sft|square f(?:ee|oo)t|sq\.? feet)\b/i;

const INTENTS = {
  help: /^\s*(hi|hello|hey|help|what can you do|how do i use)\b/i,
  method: /\b(how (is|are|do|does|was)\b.*\b(score|scored|calculat\w*|work|rank\w*)|what (is|does) (busyness|competition|the score)|explain the score)\b/i,
  why: /\bwhy\b/i,
  rent: /\b(rent|rents|cost|costs|expensive)\b/i,
  cheapest: /\b(cheap|cheapest|affordable|lowest rent|low rent)\b/i,
  gap: /\b(no|zero|without|none|missing)\s+(caf[eé]s?|coffee|qsrs?|quick[- ]service|fast[- ]food|burgers?|pizzas?)\b|\b(gaps?|untapped)\b/i,
  ranking: /\b(best|top|where|which (ward|wards|area|areas|locality|localities|neighbou?rhood)|recommend\w*|suggest\w*|should i|good (place|spot|area)|open)\b/i,
  stats: /\bhow many\b/i,
};
const ORDINAL = /(?:#|number |no\.? ?)([1-5])\b|\b(first|second|third|fourth|fifth|top one|top ward)\b/i;
const ORDINALS = { first: 1, "top one": 1, "top ward": 1, second: 2, third: 3, fourth: 4, fifth: 5 };
const FOLLOW_UP = /\b(it|there|this ward|that ward|this one|that one)\b/i;

export const EXAMPLES = [
  "Where should I open a cafe?",
  "Why is #1 ranked first?",
  "Compare Baner and Aundh",
  "Cafes in PCMC under ₹30k rent",
  "Which wards have no QSRs yet?",
  "How is the score worked out?",
];

// Ward names people might type: official titles, the OSM places inside
// each ward, and a distinctive first word ("Magarpatta").
export function wardIndex(wards) {
  const firstWords = new Map();
  for (const ward of wards) {
    const word = shortName(ward.properties).split(/[\s,-]+/)[0].toLowerCase();
    if (word.length >= 6 && word !== "near") firstWords.set(word, [...(firstWords.get(word) ?? []), ward]);
  }
  const names = [];
  for (const ward of wards) {
    const p = ward.properties;
    // "Near X" names are for wards with no place of their own, so only the
    // full name points to them; X belongs to another ward.
    const own = p.name.startsWith("Near ") ? [p.name] : [p.name, shortName(p)];
    for (const name of new Set([...own, ...p.aliases])) if (name.length >= 4) names.push({ phrase: name.toLowerCase(), ward });
  }
  for (const [word, matched] of firstWords) for (const ward of matched) names.push({ phrase: word, ward });
  return names;
}

// The wards a question names, longest phrase first; a phrase inside a
// longer match ("Deccan" in "Deccan Gymkhana") doesn't count again. Area
// names come out first, so "Pimpri-Chinchwad" isn't read as two wards.
export function mentioned(question, index) {
  const text = AREA_WORDS.reduce((t, [, pattern]) => t.replace(new RegExp(pattern.source, "gi"), " "), question.toLowerCase());
  const hits = [];
  for (const { phrase, ward } of index) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(phrase, from);
      if (at < 0) break;
      const before = text[at - 1] ?? " ";
      const after = text[at + phrase.length] ?? " ";
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) hits.push({ ward, start: at, end: at + phrase.length });
      from = at + 1;
    }
  }
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept = [];
  for (const hit of hits) {
    const inside = (k) => hit.start >= k.start && hit.end <= k.end && hit.end - hit.start < k.end - k.start;
    if (kept.some(inside)) continue;
    if (!kept.some((k) => k.ward === hit.ward)) kept.push(hit);
  }
  return kept.sort((a, b) => a.start - b.start).map((hit) => hit.ward);
}

// What the question asks for, on top of the current plan.
export function parsePlan(question, plan) {
  const asked = {};
  const formats = Object.keys(FORMATS).filter((key) => FORMATS[key].test(question));
  if (formats.length === 1) asked.category = formats[0];
  const lens = LENS_WORDS.find(([, pattern]) => pattern.test(question));
  if (lens) asked.lens = lens[0];
  const area = AREA_WORDS.find(([, pattern]) => pattern.test(question));
  if (area) asked.area = area[0];
  const budget = question.match(BUDGET);
  if (budget) {
    const unit = (budget[2] ?? "").toLowerCase();
    const amount = Number(budget[1].replace(/,/g, "")) * (unit === "k" ? 1e3 : unit.startsWith("l") ? 1e5 : 1);
    if (amount >= 1000) asked.budget = Math.round(amount);
  }
  const size = question.match(SIZE);
  if (size) asked.sqft = Number(size[1]);
  return { asked, plan: { ...plan, ...asked } };
}

export function reply(question, context) {
  const { wards, meta, rent, plan: current, ranking, index, last = [] } = context;
  const q = question.trim();
  if (!q) return { kind: "help", text: "Ask me about a ward, or where a cafe or QSR would do well.", wards: [] };
  let named = mentioned(q, index);
  if (!named.length && last.length && FOLLOW_UP.test(q) && !INTENTS.ranking.test(q)) named = last;
  const ordinal = q.match(ORDINAL);
  const position = ordinal ? Number(ordinal[1] ?? ORDINALS[ordinal[2].toLowerCase()]) : null;

  if (INTENTS.help.test(q) && !named.length && !DOMAIN.test(q.replace(INTENTS.help, ""))) return help();
  if (!named.length && position === null && !DOMAIN.test(q)) return refuse();

  const { asked, plan } = parsePlan(q, current);
  const facts = { wards, meta, rent, plan };
  if (INTENTS.method.test(q)) return method(plan, meta);
  if (position !== null && !named.length) {
    const pick = ranking[position - 1]?.feature;
    if (!pick) return { kind: "why", text: `Your shortlist has only ${ranking.length} wards right now.`, wards: [] };
    return why(pick, facts, position);
  }
  if (named.length >= 2) return compare(named, facts);
  if (named.length === 1) {
    const [ward] = named;
    if (INTENTS.why.test(q)) return why(ward, facts, positionOf(ward, ranking));
    if (INTENTS.rent.test(q) && !INTENTS.ranking.test(q)) return rentOf(ward, facts);
    return about(ward, facts, positionOf(ward, ranking));
  }
  if (INTENTS.gap.test(q)) return gaps(facts);
  if (INTENTS.cheapest.test(q)) return cheapest(facts);
  if (INTENTS.stats.test(q)) return stats(meta);
  return shortlist(facts, asked, current);
}

// ---- Answers --------------------------------------------------------------

function help() {
  return {
    kind: "help",
    text: "I answer from Localio's data on Pune's 140 wards: where a cafe or QSR would do well, what a ward "
      + "looks like, why it ranks where it does, and what rent to expect. Try one of the suggestions.",
    wards: [],
  };
}

function refuse() {
  return {
    kind: "refuse",
    text: "I only answer questions about opening a cafe or QSR in Pune, from Localio's ward data. "
      + "Try \"Where should I open a cafe?\" or \"Tell me about Baner\".",
    wards: [],
  };
}

function method(plan, meta) {
  const { weights, name } = LENSES[plan.lens];
  return {
    kind: "method",
    text: `Each ward gets a score out of 100 from two parts. Busyness: how it ranks against the other wards on `
      + `residents, food and drink outlets, and offices, colleges and stations per km². Competition: its `
      + `${CATEGORIES[plan.category].many} per 10,000 residents against the city median. With "${name}", busyness `
      + `counts ${weights.demand * 100}% and low competition ${weights.competition * 100}%. Wards with under `
      + `${meta.min_outlets} outlets mapped are left off unless you include them.`,
    wards: [],
  };
}

function about(ward, facts, position) {
  const { meta, rent, plan } = facts;
  const p = ward.properties;
  const c = CATEGORIES[plan.category];
  const stats = p.categories[plan.category];
  const part = breakdown(p, plan.category, plan.lens);
  const level = competitionLevel(p, plan.category, meta.city.per_10k[plan.category]);
  const rank = position ? ` It's #${position} on your shortlist.` : "";
  const outlets = p.total_pois
    ? `${p.total_pois} food and drink outlets, ${stats.count} of them ${c.many} (${level} competition)`
    : "no food and drink outlets mapped";
  let shaky = "";
  if (p.status !== "scored") {
    shaky = p.total_pois ? ` Only ${p.total_pois} outlets are mapped here, so treat the numbers as a lead.`
      : " With nothing mapped, check on the ground before trusting the score.";
  }
  return {
    kind: "ward",
    text: `${label(p)} has ${p.population.toLocaleString("en-US")} residents and ${outlets}. For a `
      + `${c.one} it scores ${Math.round(part.total)}/100 on ${LENSES[plan.lens].name}.${rank} Rent for `
      + `${plan.sqft} sq ft is about ${rupees(monthlyRent(rent, p, plan.sqft))} a month.${shaky}`,
    wards: [ward],
  };
}

function why(ward, facts, position) {
  const { meta, plan } = facts;
  const p = ward.properties;
  const part = breakdown(p, plan.category, plan.lens);
  const stats = p.categories[plan.category];
  const { weights } = LENSES[plan.lens];
  const place = position ? ` and is #${position} on your shortlist` : "";
  return {
    kind: "why",
    text: `${p.name} scores ${Math.round(part.total)}/100 for a ${CATEGORIES[plan.category].one}${place}. The two parts:`,
    list: [
      `Busyness ${points(part.busy)}: its busyness is ${Math.round(p.demand * 100)}/100, with `
        + `${p.residents_per_km2.toLocaleString("en-US")} residents and ${p.outlets_per_km2} outlets per km², weighted `
        + `${weights.demand * 100}%.`,
      `Low competition ${points(part.room)}: ${stats.count} ${CATEGORIES[plan.category].many} here, `
        + `${stats.per_10k.toFixed(2)} per 10,000 residents against a city median of `
        + `${meta.city.per_10k[plan.category].toFixed(2)}, weighted ${weights.competition * 100}%.`,
    ],
    wards: [ward],
  };
}

function rentOf(ward, { rent, plan }) {
  const p = ward.properties;
  const monthly = monthlyRent(rent, p, plan.sqft);
  const [low, high] = rent.healthy_share;
  const tier = p.rent.estimated ? `${p.rent.tier} tier, estimated from nearby wards` : `${p.rent.tier} tier, on ${p.rent.streets.join(" and ")}`;
  return {
    kind: "rent",
    text: `A ${plan.sqft} sq ft shop in ${p.name} costs about ${rupees(monthly)} a month (${tier}). To keep rent to `
      + `${Math.round(low * 100)}–${Math.round(high * 100)}% of sales, you'd need ${rupees(monthly / high)}–`
      + `${rupees(monthly / low)} a month in sales.`,
    wards: [ward],
  };
}

function compare(named, facts) {
  const { meta, rent, plan } = facts;
  const c = CATEGORIES[plan.category];
  const rows = named.slice(0, 4).map((ward) => {
    const p = ward.properties;
    const stats = p.categories[plan.category];
    return {
      ward,
      score: breakdown(p, plan.category, plan.lens).total,
      line: `${p.name}: ${Math.round(breakdown(p, plan.category, plan.lens).total)}/100, ${stats.count} ${c.many} `
        + `(${competitionLevel(p, plan.category, meta.city.per_10k[plan.category])} competition), busyness `
        + `${Math.round(p.demand * 100)}/100, rent ${rupees(monthlyRent(rent, p, plan.sqft))}/month`,
    };
  });
  const best = [...rows].sort((a, b) => b.score - a.score)[0];
  return {
    kind: "compare",
    text: `For a ${c.one} on ${LENSES[plan.lens].name}, ${best.ward.properties.name} comes out ahead:`,
    list: rows.map((row) => row.line),
    wards: rows.map((row) => row.ward),
  };
}

function shortlist(facts, asked, current) {
  const { wards, rent, plan } = facts;
  const ranked = rank(wards, plan, rent).slice(0, 5);
  const c = CATEGORIES[plan.category];
  const scope = describe(plan);
  if (!ranked.length) {
    return {
      kind: "ranking", text: `No ward fits this plan (${scope}). Try a higher rent budget or another area.`,
      wards: [], plan: changed(asked, current),
    };
  }
  return {
    kind: "ranking",
    text: `Top ${ranked.length} for a ${c.one} (${scope}):`,
    list: ranked.map(({ feature, score }) => `${feature.properties.name}: ${Math.round(score)}/100, rent `
      + `${rupees(monthlyRent(rent, feature.properties, plan.sqft))}/month`),
    wards: ranked.map(({ feature }) => feature),
    plan: changed(asked, current),
  };
}

function gaps(facts) {
  const { wards, plan } = facts;
  const c = CATEGORIES[plan.category];
  const found = wards
    .filter(({ properties: p }) => p.status === "scored" && p.categories[plan.category].count === 0
      && (plan.area === "all" || p.corporation.toLowerCase() === plan.area))
    .sort((a, b) => b.properties.demand - a.properties.demand)
    .slice(0, 5);
  if (!found.length) {
    return { kind: "gap", text: `Every ward with enough data already has at least one ${c.one} mapped.`, wards: [] };
  }
  return {
    kind: "gap",
    text: `Wards with no ${c.many} mapped yet, busiest first${plan.area === "all" ? "" : ` (${AREAS[plan.area]})`}:`,
    list: found.map(({ properties: p }) => `${p.name}: busyness ${Math.round(p.demand * 100)}/100, ${p.total_pois} outlets of other kinds`),
    wards: found,
  };
}

function cheapest(facts) {
  const { wards, rent, plan } = facts;
  const found = rank(wards, { ...plan, budget: null }, rent)
    .sort((a, b) => a.feature.properties.rent.multiplier - b.feature.properties.rent.multiplier || b.score - a.score)
    .slice(0, 5);
  return {
    kind: "cheapest",
    text: `Lowest rent for ${plan.sqft} sq ft, best score first within each tier${plan.area === "all" ? "" : ` (${AREAS[plan.area]})`}:`,
    list: found.map(({ feature, score }) => `${feature.properties.name}: ${rupees(monthlyRent(rent, feature.properties, plan.sqft))}/month, `
      + `score ${Math.round(score)}/100`),
    wards: found.map(({ feature }) => feature),
  };
}

function stats(meta) {
  const { cafe, fast_food: qsr } = meta.category_counts;
  return {
    kind: "stats",
    text: `Localio's data has ${meta.outlets.toLocaleString("en-US")} food and drink outlets in Pune's 140 wards: `
      + `${cafe} cafes and ${qsr} QSRs; the rest are restaurants. Ask about a ward for its own counts.`,
    wards: [],
  };
}

// ---- Helpers --------------------------------------------------------------

function describe(plan) {
  const parts = [LENSES[plan.lens].name, AREAS[plan.area]];
  if (plan.budget) parts.push(`rent up to ${rupees(plan.budget)} for ${plan.sqft} sq ft`);
  return parts.join(", ");
}

// Only the settings the question asked for that differ from the plan.
function changed(asked, current) {
  const diff = Object.fromEntries(Object.entries(asked).filter(([key, value]) => current[key] !== value));
  return Object.keys(diff).length ? diff : null;
}

function positionOf(ward, ranking) {
  const index = ranking.findIndex(({ feature }) => feature === ward);
  return index >= 0 && index < 5 ? index + 1 : null;
}

function points(value) {
  const n = Math.round(value);
  return `${n} ${n === 1 ? "point" : "points"}`;
}

// "Koregaon Park (PMC ward 21)"; PCMC names already carry their number.
function label(p) {
  return p.corporation === "PMC" ? `${p.name} (PMC ward ${p.ward_number})` : p.name;
}

function shortName(p) {
  return p.name.replace(/\s*\(PCMC \d+\)$/, "");
}
