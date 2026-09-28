import { CATEGORIES, compact, counted, num } from "./format.js";

// Each lens re-weights the same three normalized components the pipeline
// ships, so switching lenses re-ranks instantly with no request.
export const LENSES = {
  competition: {
    name: "Low competition",
    weights: { demand: 0.30, supply: 0.55, weakness: 0.15 },
    describe: (c) => `Favours areas with the fewest ${c.many} already open.`,
  },
  footfall: {
    name: "Proven footfall",
    weights: { demand: 0.60, supply: 0.28, weakness: 0.12 },
    describe: (c) => `Favours the busiest areas, even if some ${c.many} are already there.`,
  },
  incumbents: {
    name: "Weak incumbents",
    weights: { demand: 0.35, supply: 0.30, weakness: 0.35 },
    describe: (c) => `Favours areas where the ${c.many} already open are poorly rated.`,
  },
};

// Every locality has a score; the ones with fewer than 4 outlets are
// low-confidence and kept off the shortlist.
export function score(properties, category, weights) {
  const { demand_n, supply_n, weakness_n } = properties.categories[category];
  return 100 * (weights.demand * demand_n - weights.supply * supply_n + weights.weakness * weakness_n);
}

export function rank(localities, category, lens) {
  const { weights } = LENSES[lens];
  return localities
    .filter((feature) => feature.properties.status === "scored")
    .map((feature) => ({ feature, score: score(feature.properties, category, weights) }))
    .sort((a, b) => b.score - a.score || a.feature.properties.name.localeCompare(b.feature.properties.name));
}

export function cityRating(pois, category) {
  const ratings = pois
    .filter((poi) => poi.properties.category === category && poi.properties.avg_rating !== null)
    .map((poi) => poi.properties.avg_rating);
  return ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
}

// Above this multiple of the city median, competition counts as heavy.
// The pipeline's recommendation sentence uses the same line.
const CROWDED = 1.5;

// One line per pick, built from that locality's own numbers. It leads with
// whichever term adds the most to the score under the current lens, and
// every word in it ("thin", "strong") is backed by a threshold. Competition
// is judged against the city median per 10,000 residents.
export function rationale(properties, category, lens, { averageRating, cityPer10k }) {
  const { weights } = LENSES[lens];
  const stats = properties.categories[category];
  const outlets = `${num(properties.total_pois)} F&amp;B outlets`;
  const footfall = ["light", "steady", "strong"][third(stats.demand_n)];

  if (stats.count === 0) {
    return `${outlets} and no ${CATEGORIES[category].one} yet — ${footfall} footfall, no direct competition.`;
  }

  const pull = {
    demand: weights.demand * stats.demand_n,
    gap: weights.supply * (1 - stats.supply_n),
    weakness: weights.weakness * stats.weakness_n,
  };
  const lead = Object.keys(pull).reduce((a, b) => (pull[b] > pull[a] ? b : a));
  // Compared as displayed, so the line never reads "4.4★, below 4.4★".
  const rating = stats.avg_rating?.toFixed(1);
  const cityAverage = averageRating?.toFixed(1);

  if (lead === "weakness" && rating && cityAverage && Number(rating) < Number(cityAverage)) {
    return `${counted(stats.count, category)} averaging ${num(rating)}★, ` +
      `below the ${num(cityAverage)}★ city average — room to beat the incumbents.`;
  }
  const competition = stats.per_10k <= cityPer10k ? "thin" : stats.per_10k <= CROWDED * cityPer10k ? "moderate" : "heavy";
  if (competition === "thin") {
    return `${outlets} nearby but only ${counted(stats.count, category)} — ${footfall} footfall, thin competition.`;
  }
  return `${num(compact(properties.total_reviews))} reviews across ${outlets}, ${counted(stats.count, category)} ` +
    `among them — ${footfall} footfall, ${competition} competition.`;
}

function third(value) {
  return Math.min(2, Math.floor(value * 3));
}
