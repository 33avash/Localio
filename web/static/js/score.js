import { CATEGORIES, counted, num } from "./format.js";

// Each lens re-weights the same three normalized components the pipeline
// ships, so switching lenses re-ranks instantly with no request.
export const LENSES = {
  competition: {
    name: "Low competition",
    weights: { demand: 0.30, supply: 0.55, gap: 0.15 },
    describe: (c) => `Favours wards with the fewest ${c.many} per resident.`,
  },
  footfall: {
    name: "Proven footfall",
    weights: { demand: 0.60, supply: 0.28, gap: 0.12 },
    describe: (c) => `Favours wards whose surroundings support the most trade, even if some ${c.many} are there.`,
  },
  gap: {
    name: "Unmet demand",
    weights: { demand: 0.35, supply: 0.30, gap: 0.35 },
    describe: () => "Favours wards with fewer outlets than wards like them usually hold.",
  },
};

// Every ward has a score; the ones with fewer than 4 outlets are
// low-confidence and kept off the shortlist unless asked for.
export function score(properties, category, weights) {
  const { demand_n, supply_n, gap_n } = properties.categories[category];
  return 100 * (weights.demand * demand_n - weights.supply * supply_n + weights.gap * gap_n);
}

// Low-confidence wards (fewer than 4 outlets) are left out unless asked for.
export function rank(localities, category, lens, { includeLow = false } = {}) {
  const { weights } = LENSES[lens];
  return localities
    .filter((feature) => includeLow || feature.properties.status === "scored")
    .map((feature) => ({ feature, score: score(feature.properties, category, weights) }))
    .sort((a, b) => b.score - a.score || a.feature.properties.name.localeCompare(b.feature.properties.name));
}

// Above this multiple of the city median, competition counts as heavy.
// The pipeline's recommendation sentence uses the same line.
const CROWDED = 1.5;

// One line per pick, built from that ward's own numbers. It leads with
// whichever term adds the most to the score under the current lens, and
// every word in it ("thin", "strong") is backed by a threshold.
export function rationale(properties, category, lens, { cityPer10k }) {
  const { weights } = LENSES[lens];
  const stats = properties.categories[category];
  const outlets = `${num(properties.total_pois)} food and drink ${properties.total_pois === 1 ? "outlet" : "outlets"}`;
  const demand = ["weak", "moderate", "strong"][third(stats.demand_n)];

  if (stats.count === 0) {
    return `${outlets} and no ${CATEGORIES[category].one} yet — ${demand} demand signal, no direct competition.`;
  }
  const pull = {
    demand: weights.demand * stats.demand_n,
    room: weights.supply * (1 - stats.supply_n),
    gap: weights.gap * stats.gap_n,
  };
  const lead = Object.keys(pull).reduce((a, b) => (pull[b] > pull[a] ? b : a));
  const expected = Math.round(properties.total_pois + properties.capacity.gap);
  if (lead === "gap" && expected > properties.total_pois) {
    return `${outlets} where wards like it hold about ${num(expected)} — room for more.`;
  }
  const competition = stats.per_10k <= cityPer10k ? "thin" : stats.per_10k <= CROWDED * cityPer10k ? "moderate" : "heavy";
  if (competition === "thin") {
    return `${outlets} but only ${counted(stats.count, category)} — ${demand} demand signal, thin competition.`;
  }
  return `${counted(stats.count, category)} among ${outlets} — ${demand} demand signal, ${competition} competition.`;
}

function third(value) {
  return Math.min(2, Math.floor(value * 3));
}
