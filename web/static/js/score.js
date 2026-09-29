// The score, as data/localio/score.py defines it:
//   score = 100 × Σ(weight × component) / Σ(weights)
// The pipeline ships each ward's four components (0–1) and the presets, so
// moving any weight re-ranks instantly, with no request. A test checks
// this file gives the pipeline's scores for every ward.
import { CATEGORIES } from "./format.js";

export const COMPONENTS = [
  {
    key: "residents", label: "Residents", colour: "#3D8F7B",
    about: "how densely people live here",
    measure: (p) => `${p.residents_per_km2.toLocaleString("en-US")} residents per km²`,
  },
  {
    key: "eating_out", label: "Eating out", colour: "#72B7A5",
    about: "how many places to eat and drink there are already",
    measure: (p) => `${p.outlets_per_km2} food and drink places per km²`,
  },
  {
    key: "daytime", label: "Daytime draw", colour: "#A9D6C9",
    about: "offices, colleges and stations that bring people in by day",
    measure: (p) => `${p.draws_per_km2} per km² (${p.draws.offices} offices, ${p.draws.colleges} colleges, `
      + `${p.draws.stations} stations)`,
  },
  {
    key: "room", label: "Low competition", colour: "#C9A0DC",
    about: "how few places like yours there are per resident",
    measure: (p, category) => `${p.categories[category].count} ${CATEGORIES[category].many}, `
      + `${p.categories[category].per_10k.toFixed(2)} per 10k residents`,
  },
];

export const PRESET_NAMES = { balanced: "Balanced", busy: "Busy areas", quiet: "Low competition" };

export const AREAS = {
  all: "All of Pune",
  pmc: "Pune city",
  pcmc: "Pimpri-Chinchwad",
};

// The ward's four components for this format, each 0–1.
export function components(properties, category) {
  return { ...properties.components, room: properties.categories[category].room };
}

// The score broken into its parts: each component's value, its share of
// the weight and the points it adds. The points always sum to the score.
// With every weight at zero, all four count equally rather than nothing.
export function parts(properties, category, weights) {
  const values = components(properties, category);
  const sum = COMPONENTS.reduce((total, c) => total + weights[c.key], 0);
  const items = COMPONENTS.map((c) => {
    const share = sum ? weights[c.key] / sum : 1 / COMPONENTS.length;
    return { ...c, value: values[c.key], weight: weights[c.key], share, points: 100 * share * values[c.key] };
  });
  return { items, total: items.reduce((total, item) => total + item.points, 0) };
}

// Rounds each part so the rounded parts add up to the rounded score
// (largest remainder), so a row never shows 12 + 18 + 9 + 33 = 71.
export function roundedParts(items) {
  const total = Math.round(items.reduce((sum, item) => sum + item.points, 0));
  const floors = items.map((item) => Math.floor(item.points));
  let left = total - floors.reduce((a, b) => a + b, 0);
  const order = items.map((item, i) => [item.points - floors[i], i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    floors[i] += 1;
    left -= 1;
  }
  return floors;
}

// A percentile (the share of other wards with a lower value), in words.
export function standing(value) {
  if (value >= 1) return "the highest of Pune's 140 wards";
  if (value <= 0) return "the lowest of Pune's 140 wards";
  return value >= 0.5 ? `higher than ${Math.round(value * 100)}% of wards` : `lower than ${Math.round((1 - value) * 100)}% of wards`;
}

// The preset these weights match, if any.
export function presetOf(weights, presets) {
  return Object.keys(presets).find((name) => COMPONENTS.every((c) => presets[name][c.key] === weights[c.key])) ?? null;
}

// Monthly rent for a shop of this size: typical ₹/sq ft × the ward's tier.
export function monthlyRent(rent, properties, sqft) {
  return Math.round(rent.typical_psf * properties.rent.multiplier * sqft);
}

// Every ward that fits the plan, best first. Wards with too few outlets
// mapped are left out unless the plan includes them.
export function rank(wards, plan, rent) {
  return wards
    .filter(({ properties: p }) => (plan.includeLow || p.status === "scored")
      && (plan.area === "all" || p.corporation.toLowerCase() === plan.area)
      && (!plan.budget || monthlyRent(rent, p, plan.sqft) <= plan.budget))
    .map((feature) => ({ feature, score: parts(feature.properties, plan.category, plan.weights).total }))
    .sort((a, b) => b.score - a.score || a.feature.properties.name.localeCompare(b.feature.properties.name));
}

// "none mapped", "light", "average" or "heavy": this format's outlets per
// 10,000 residents against the rate in well-mapped wards. The pipeline's
// recommendation sentence uses the same lines (data/localio/recommend.py).
export function competitionLevel(properties, category, reference) {
  const { count, per_10k: per10k } = properties.categories[category];
  if (count === 0) return "none mapped";
  const ratio = per10k / reference;
  return ratio <= 0.5 ? "light" : ratio <= 1.5 ? "average" : "heavy";
}
