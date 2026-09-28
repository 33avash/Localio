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

// "thin", "moderate" or "heavy": this format's outlets per 10k residents
// against the city median.
export function competition(properties, category, cityPer10k) {
  const { count, per_10k: per10k } = properties.categories[category];
  if (count === 0) return "no";
  return per10k <= cityPer10k ? "thin" : per10k <= CROWDED * cityPer10k ? "moderate" : "heavy";
}
