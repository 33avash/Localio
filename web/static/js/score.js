// The score, as data/localio/score.py defines it:
//   score = 100 × (w_busy × busyness + w_room × (1 − competition))
// The pipeline ships each ward's busyness and competition (both 0–1), so
// changing any input re-ranks instantly, with no request.
export const LENSES = {
  busy: {
    name: "Busy areas",
    weights: { demand: 0.8, competition: 0.2 },
    describe: "Most people living, eating out, working and travelling there.",
  },
  balanced: {
    name: "Balanced",
    weights: { demand: 0.5, competition: 0.5 },
    describe: "Busy, but not already full of places like yours.",
  },
  quiet: {
    name: "Low competition",
    weights: { demand: 0.2, competition: 0.8 },
    describe: "Fewest places like yours per resident, even if quieter.",
  },
};

export const AREAS = {
  all: "All of Pune",
  pmc: "Pune city",
  pcmc: "Pimpri-Chinchwad",
};

// The two parts of a score, in points: busyness plus room (low
// competition). They always add up to the score.
export function breakdown(properties, category, lens) {
  const { weights } = LENSES[lens];
  const busy = 100 * weights.demand * properties.demand;
  const room = 100 * weights.competition * (1 - properties.categories[category].competition);
  return { busy, room, total: busy + room };
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
    .map((feature) => ({ feature, score: breakdown(feature.properties, plan.category, plan.lens).total }))
    .sort((a, b) => b.score - a.score || a.feature.properties.name.localeCompare(b.feature.properties.name));
}

// Above this multiple of the city median, competition counts as heavy.
// The pipeline's recommendation sentence uses the same line.
const CROWDED = 1.5;

// "no", "thin", "moderate" or "heavy": this format's outlets per 10,000
// residents against the city median.
export function competitionLevel(properties, category, cityPer10k) {
  const { count, per_10k: per10k } = properties.categories[category];
  if (count === 0) return "no";
  return per10k <= cityPer10k ? "thin" : per10k <= CROWDED * cityPer10k ? "moderate" : "heavy";
}
