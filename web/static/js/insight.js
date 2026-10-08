// Analysis on top of the score: how sure we are, why a ward ranks where it
// does, how stable that rank is, and what a change of brief did. Nothing
// here changes a score; everything is derived from the published ward data
// and score.js, so every statement can be traced back to a number.
import { CATEGORIES, rupees } from "./format.js";
import {
  AREAS, briefOf, COMPETITION, competitionLevel, COMPONENTS, CUSTOMERS, leftOut, monthlyRent, parts, rank, standing,
} from "./score.js";

// ---- Fit bands: the map's colour bands, named --------------------------

export const FIT_BREAKS = [45, 55, 65, 75];
export const FIT_LABELS = ["Low fit", "Fair fit", "Good fit", "Strong fit", "High fit"];

export function fitBand(score) {
  const index = FIT_BREAKS.filter((limit) => Math.round(score) >= limit).length;
  return { index, label: FIT_LABELS[index] };
}

// ---- Confidence: how far to trust a ward's numbers -----------------------
// Three signals, each from the data:
//   outlets    10+ mapped (the shortlist's own threshold), or thin
//   residents  Census 2011 shared by the 2012 voter roll, or an equal share
//   rent       a published high street, or the zone's tier
// High: all three solid. Medium: outlets solid, one of the others weak.
// Low: thin outlets, or both of the others weak.

export function confidence(p, meta) {
  const outlets = p.status === "scored"
    ? { ok: true, text: `${p.total_pois} outlets mapped, above the ${meta.min_outlets} needed to trust the counts` }
    : { ok: false, text: `Only ${p.total_pois} outlets mapped, so competition and eating out may be mapping gaps` };
  const voters = p.population_method.startsWith("2012 voters");
  const residents = voters
    ? { ok: true, text: "Residents: Census 2011 shared by the ward's 2012 voter roll" }
    : { ok: false, text: p.corporation === "PCMC"
      ? "Residents: an equal share of PCMC's 2011 total (no voter roll)"
      : "Residents: the PMC average (no voter count for this ward)" };
  const rent = p.rent.estimated
    ? { ok: false, text: `Rent: the ${p.rent.tier} tier of its zone, not a published street` }
    : { ok: true, text: `Rent: on a published high street (${p.rent.streets.join(", ")})` };
  const weak = [residents, rent].filter((s) => !s.ok).length;
  const level = !outlets.ok || weak === 2 ? "Low" : weak === 1 ? "Medium" : "High";
  const signals = { outlets, residents, rent };
  const reasons = Object.values(signals).filter((s) => !s.ok).map((s) => s.text);
  return { level, signals, reasons, summary: reasons[0] ?? "Well-mapped outlets, voter-roll residents and a published rent" };
}

// ---- Freshness: how old a source is, at the time of the build -----------
// Measured from the pipeline's run, not the viewer's clock, so a page shows
// the same verdict whenever it's opened. Within a year: high. Within five:
// medium. Older: low.

export function freshness(asOf, builtAt) {
  const built = new Date(builtAt);
  const when = /^\d{4}$/.test(asOf) ? new Date(`${asOf}-12-31`) : new Date(asOf);
  const years = (built - when) / (365.25 * 24 * 3600 * 1000);
  const level = years <= 1 ? "High" : years <= 5 ? "Medium" : "Low";
  return { level, years, label: /^\d{4}$/.test(asOf) ? asOf : when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) };
}

// ---- Strengths and risks, from the ward's own values --------------------

export function caseFor(p, { plan, meta, rent }) {
  const reference = meta.score.reference_per_10k[plan.category];
  const fmt = CATEGORIES[plan.category];
  const { items } = parts(p, plan.category, plan.weights);
  const strengths = [];
  const risks = [];
  for (const item of items.filter((i) => i.key !== "room")) {
    if (item.value >= 0.7) strengths.push({ rank: item.points + 1, text: `${item.label}: ${standing(item.value)}`, detail: item.measure(p, plan.category) });
    else if (item.value <= 0.3 && item.share >= 0.25) {
      risks.push({ rank: item.share * 10, text: `Weak ${item.label.toLowerCase()}: ${standing(item.value)}`, detail: item.measure(p, plan.category) });
    }
  }
  const level = competitionLevel(p, plan.category, reference);
  const { count, per_10k: per10k } = p.categories[plan.category];
  const density = `${count} ${count === 1 ? fmt.one : fmt.many} mapped, ${per10k.toFixed(2)} per 10k residents; ${reference.toFixed(2)} in well-mapped wards`;
  if (level === "heavy") risks.push({ rank: 9, text: `Heavy competition for a ${fmt.one}`, detail: density });
  else if (level === "light") strengths.push({ rank: 8, text: `Light competition for a ${fmt.one}`, detail: density });
  else if (level === "none mapped" && p.status === "scored") strengths.push({ rank: 7, text: `No ${fmt.many} mapped yet`, detail: "Check on the ground: OpenStreetMap misses outlets" });
  const monthly = monthlyRent(rent, p, plan.sqft);
  if (plan.budget) {
    if (monthly <= plan.budget * 0.9) strengths.push({ rank: 6, text: `Rent fits your ceiling with room to spare`, detail: `${rupees(monthly)} a month against ${rupees(plan.budget)}` });
    else if (monthly > plan.budget) risks.push({ rank: 10, text: `Rent over your ceiling`, detail: `${rupees(monthly)} a month against ${rupees(plan.budget)}` });
  } else if (["premium", "high"].includes(p.rent.tier)) {
    risks.push({ rank: 5, text: `${cap(p.rent.tier)} rent tier`, detail: `${rupees(monthly)} a month for ${plan.sqft} sq ft` });
  } else if (["value", "emerging"].includes(p.rent.tier)) {
    strengths.push({ rank: 4, text: `${cap(p.rent.tier)} rent tier`, detail: `${rupees(monthly)} a month for ${plan.sqft} sq ft` });
  }
  if (p.status !== "scored") risks.push({ rank: 11, text: "Thin outlet data", detail: `Only ${p.total_pois} outlets mapped; counts may be gaps in the map` });
  if (p.rent.estimated) risks.push({ rank: 3, text: "Rent estimated from the zone", detail: `No published high street runs through it; ${p.rent.tier} tier assumed` });
  if (!p.population_method.startsWith("2012 voters")) risks.push({ rank: 2, text: "Residents are an estimate", detail: p.population_method });
  if (plan.weights.daytime > 0 && p.draws.stations === 0) risks.push({ rank: 1, text: "No stations mapped in the ward", detail: "Rail, metro and bus stations from OpenStreetMap" });
  const top = (list) => list.sort((a, b) => b.rank - a.rank).slice(0, 3);
  return { strengths: top(strengths), risks: top(risks) };
}

// ---- Sensitivity: the ward's rank under nearby briefs --------------------

export const BUDGET_LADDER = [25000, 35000, 50000, 75000, null];

export function rankOf(name, wards, plan, rent) {
  const p = wards.find((f) => f.properties.name === name)?.properties;
  if (!p) return { rank: null, out: "not a ward" };
  const out = leftOut(p, plan, rent);
  if (out) return { rank: null, out };
  const list = rank(wards, plan, rent);
  return { rank: list.findIndex((r) => r.feature.properties === p) + 1, of: list.length };
}

export function sensitivity(name, { wards, plan, rent }) {
  const budgets = [...new Set([...BUDGET_LADDER.filter((b) => b !== null), plan.budget].filter(Boolean))].sort((a, b) => a - b);
  const byBudget = [...budgets, null].map((budget) => ({
    label: budget ? rupees(budget) : "No ceiling", current: budget === (plan.budget ?? null),
    ...rankOf(name, wards, { ...plan, budget }, rent),
  }));
  const byCompetition = Object.entries(COMPETITION).map(([key, c]) => ({
    label: c.label, current: plan.weights.room === c.room,
    ...rankOf(name, wards, { ...plan, weights: { ...plan.weights, room: c.room } }, rent),
  }));
  const ranks = [...byBudget, ...byCompetition].filter((r) => r.rank).map((r) => r.rank);
  const top5 = [...byBudget, ...byCompetition].filter((r) => r.rank && r.rank <= 5).length;
  const total = byBudget.length + byCompetition.length;
  let verdict;
  if (!ranks.length) verdict = "Out of the list under every one of these briefs.";
  else if (top5 === total) verdict = `In the top 5 under all ${total} of these briefs: a stable pick.`;
  else if (top5 >= total / 2) verdict = `In the top 5 under ${top5} of ${total} briefs: fairly stable.`;
  else verdict = `In the top 5 under ${top5} of ${total} briefs: sensitive to your assumptions.`;
  return { byBudget, byCompetition, verdict };
}

// ---- What changed: two rankings and the briefs behind them --------------

export function changes(before, after) {
  const said = [];
  const a = before.plan;
  const b = after.plan;
  if (a.category !== b.category) said.push(`Format ${CATEGORIES[a.category].label} → ${CATEGORIES[b.category].label}`);
  if (a.area !== b.area) said.push(`Area ${AREAS[a.area]} → ${AREAS[b.area]}`);
  if (a.sqft !== b.sqft) said.push(`Shop size ${a.sqft} → ${b.sqft} sq ft`);
  if ((a.budget ?? null) !== (b.budget ?? null)) said.push(`Rent ceiling ${a.budget ? rupees(a.budget) : "none"} → ${b.budget ? rupees(b.budget) : "none"}`);
  if (a.includeLow !== b.includeLow) said.push(b.includeLow ? "Thin-data wards included" : "Thin-data wards left out");
  const wa = briefOf(a.weights);
  const wb = briefOf(b.weights);
  if (wa.customers !== wb.customers) said.push(`Customers ${label(CUSTOMERS, wa.customers)} → ${label(CUSTOMERS, wb.customers)}`);
  if (wa.competition !== wb.competition) said.push(`Competition ${label(COMPETITION, wa.competition)} → ${label(COMPETITION, wb.competition)}`);
  if (wa.customers === wb.customers && wa.competition === wb.competition && JSON.stringify(a.weights) !== JSON.stringify(b.weights)) said.push("Weights adjusted");
  return said;
}

export function diff(before, after, { wards, rent }) {
  const position = (list) => new Map(list.map((r, i) => [r.feature.properties.name, i + 1]));
  const was = position(before.ranking);
  const now = position(after.ranking);
  const top = (list) => list.slice(0, 5).map((r) => r.feature.properties.name);
  const entered = top(after.ranking).filter((n) => !top(before.ranking).includes(n));
  const exited = top(before.ranking).filter((n) => !top(after.ranking).includes(n));
  let mover = null;
  for (const name of top(after.ranking)) {
    const from = was.get(name) ?? null;
    const to = now.get(name);
    const gain = from === null ? Infinity : from - to;
    if (gain > 0 && (!mover || gain > mover.gain)) mover = { name, from, to, gain };
  }
  if (mover) {
    const p = wards.find((f) => f.properties.name === mover.name).properties;
    const out = leftOut(p, before.plan, rent);
    const scoreBefore = Math.round(parts(p, before.plan.category, before.plan.weights).total);
    const scoreAfter = Math.round(parts(p, after.plan.category, after.plan.weights).total);
    mover.reason = out ? `It was left out before: ${out}.`
      : scoreAfter !== scoreBefore ? `Its score went from ${scoreBefore} to ${scoreAfter} under the new weights.`
        : "Its score held while wards above it dropped out or fell back.";
  }
  return { said: changes(before, after), entered, exited, mover, count: { before: before.ranking.length, after: after.ranking.length } };
}

// ---- Market: the whole city for the current brief ------------------------

export function market({ wards, plan, rent, meta }) {
  const reference = meta.score.reference_per_10k[plan.category];
  const rows = wards.map(({ properties: p }) => ({
    p,
    score: parts(p, plan.category, plan.weights).total,
    out: leftOut(p, plan, rent),
    rent: monthlyRent(rent, p, plan.sqft),
    level: competitionLevel(p, plan.category, reference),
    demand: (p.components.residents + p.components.eating_out + p.components.daytime) / 3,
    confidence: confidence(p, meta).level,
  }));
  const bands = FIT_LABELS.map((name, index) => ({ name, index, count: rows.filter((r) => !r.out && fitBand(r.score).index === index).length }));
  const levels = ["none mapped", "light", "average", "heavy"].map((name) => ({
    name,
    mapped: rows.filter((r) => r.level === name && r.p.status === "scored").length,
    thin: rows.filter((r) => r.level === name && r.p.status !== "scored").length,
  }));
  const tiers = Object.entries(rent.tiers).map(([name, t]) => ({ name, multiplier: t.multiplier, count: rows.filter((r) => r.p.rent.tier === name).length,
    monthly: Math.round(rent.typical_psf * t.multiplier * plan.sqft) }));
  const coverage = ["PMC", "PCMC"].map((corp) => ({
    corp,
    wards: rows.filter((r) => r.p.corporation === corp).length,
    mapped: rows.filter((r) => r.p.corporation === corp && r.p.status === "scored").length,
  }));
  const conf = ["High", "Medium", "Low"].map((name) => ({ name, count: rows.filter((r) => r.confidence === name).length }));
  const rents = rows.map((r) => r.rent).sort((x, y) => x - y);
  // An opportunity signal, not a promise: well-mapped wards with strong
  // people numbers and little competition for this format, within budget.
  const signals = rows
    .filter((r) => r.p.status === "scored" && r.demand >= 0.6 && ["light", "none mapped"].includes(r.level)
      && (!plan.budget || r.rent <= plan.budget) && (plan.area === "all" || r.p.corporation.toLowerCase() === plan.area))
    .sort((x, y) => y.demand - x.demand);
  return {
    total: rows.length,
    fitting: rows.filter((r) => !r.out).length,
    bands, levels, tiers, coverage, conf, signals,
    rent: { low: rents[0], median: rents[Math.floor(rents.length / 2)], high: rents.at(-1) },
    draws: ["offices", "colleges", "stations"].map((k) => ({ name: k, count: rows.reduce((s, r) => s + r.p.draws[k], 0) })),
  };
}

// ---- Export: the full ranking as CSV ------------------------------------

export function shortlistCsv({ ranking, plan, rent, meta }) {
  const reference = meta.score.reference_per_10k[plan.category];
  const fmt = CATEGORIES[plan.category];
  const header = ["rank", "ward", "corporation", "ward_number", "score", "fit", ...COMPONENTS.map((c) => `${c.key}_points`),
    "monthly_rent_inr", "rent_per_sqft_inr", "rent_basis", `${fmt.many}_mapped`, "competition", "confidence"];
  const lines = ranking.map(({ feature }, i) => {
    const p = feature.properties;
    const { items, total } = parts(p, plan.category, plan.weights);
    return [i + 1, p.name, p.corporation, p.ward_number, Math.round(total), fitBand(total).label,
      ...items.map((item) => item.points.toFixed(1)),
      monthlyRent(rent, p, plan.sqft), Math.round(rent.typical_psf * p.rent.multiplier),
      p.rent.estimated ? `${p.rent.tier} tier (zone estimate)` : `${p.rent.tier} tier (${p.rent.streets.join("; ")})`,
      p.categories[plan.category].count, competitionLevel(p, plan.category, reference), confidence(p, meta).level];
  });
  return [header, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function label(table, key) {
  return key ? table[key].label.toLowerCase() : "your own weights";
}

function cap(text) {
  return text[0].toUpperCase() + text.slice(1);
}
