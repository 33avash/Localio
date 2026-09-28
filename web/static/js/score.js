// The score, as data/localio/score.py defines it:
//   score = 100 × (w_demand × demand + w_competition × (1 − competition))
// The pipeline ships each ward's demand and competition (both 0–1), so
// switching priority re-ranks instantly, with no request.
export const LENSES = {
  busy: {
    name: "Busy areas",
    weights: { demand: 0.8, competition: 0.2 },
    describe: () => "Where the most people live, eat out, work, study and travel.",
  },
  balanced: {
    name: "Balanced",
    weights: { demand: 0.5, competition: 0.5 },
    describe: (c) => `Busy areas without too many ${c.many} already.`,
  },
  quiet: {
    name: "Low competition",
    weights: { demand: 0.2, competition: 0.8 },
    describe: (c) => `The fewest ${c.many} per resident, even if it's quieter.`,
  },
};

export function score(properties, category, weights) {
  const { competition } = properties.categories[category];
  return 100 * (weights.demand * properties.demand + weights.competition * (1 - competition));
}

// Low-confidence wards (too few outlets mapped) are left out unless asked for.
export function rank(wards, category, lens, { includeLow = false } = {}) {
  const { weights } = LENSES[lens];
  return wards
    .filter((feature) => includeLow || feature.properties.status === "scored")
    .map((feature) => ({ feature, score: score(feature.properties, category, weights) }))
    .sort((a, b) => b.score - a.score || a.feature.properties.name.localeCompare(b.feature.properties.name));
}

// Above this multiple of the city median, competition counts as heavy.
// The pipeline's recommendation sentence uses the same line.
const CROWDED = 1.5;

// "none", "thin", "moderate" or "heavy": this format's outlets per 10,000
// residents against the city median.
export function competitionLevel(properties, category, cityPer10k) {
  const { count, per_10k: per10k } = properties.categories[category];
  if (count === 0) return "none";
  return per10k <= cityPer10k ? "thin" : per10k <= CROWDED * cityPer10k ? "moderate" : "heavy";
}

// Monthly rent for a shop of this size: typical ₹/sq ft × the ward's tier.
export function monthlyRent(rent, properties, sqft) {
  return Math.round(rent.typical_psf * properties.rent.multiplier * sqft);
}
