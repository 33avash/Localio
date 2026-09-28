import { CATEGORIES, compact, escapeHtml, num } from "./format.js";
import { LENSES, score } from "./score.js";

export function outletPopup({ name, category, locality, avg_rating, review_count, is_chain }) {
  const rating = avg_rating === null ? "No rating yet" : `${num(avg_rating.toFixed(1))}★`;
  const reviews = `${num(review_count.toLocaleString("en-US"))} ${review_count === 1 ? "review" : "reviews"}`;
  return `
    <h3>${escapeHtml(name)}</h3>
    <p class="popup-sub">${CATEGORIES[category].label} · ${is_chain ? "Chain" : "Independent"} · ${escapeHtml(locality)}</p>
    <p>${rating} · ${reviews}</p>`;
}

// Both formats side by side, with the one being opened highlighted: a QSR
// founder still wants to know how crowded the cafe scene is.
export function localityPopup(properties, { category, lens }) {
  const keys = Object.keys(CATEGORIES);
  const chosen = (key) => (key === category ? ' class="chosen"' : "");
  const row = (label, value) =>
    `<tr><th scope="row">${label}</th>${keys.map((key) => `<td${chosen(key)}>${value(properties.categories[key])}</td>`).join("")}</tr>`;

  const outlets = `${num(properties.total_pois)} ${properties.total_pois === 1 ? "outlet" : "outlets"}`;
  const residents = `${num(compact(properties.population))} residents`;
  const summary = properties.status === "scored"
    ? `${residents} · ${outlets} · ${num(compact(properties.total_reviews))} reviews`
    : `${residents} · ${outlets} · too few to score`;
  const points = category && lens ? score(properties, category, LENSES[lens].weights) : null;
  const scoreLine = points === null
    ? ""
    : `<p class="popup-score">Score for a new ${CATEGORIES[category].one}: ${num(points.toFixed(1))}</p>`;

  return `
    <h3>${escapeHtml(properties.name)}</h3>
    <p class="popup-sub">${summary}</p>
    <table>
      <thead><tr><td></td>${keys.map((key) => `<th scope="col"${chosen(key)}>${CATEGORIES[key].label}</th>`).join("")}</tr></thead>
      <tbody>
        ${row("Outlets", (s) => num(s.count))}
        ${row("Per 10k residents", (s) => num(s.per_10k.toFixed(2)))}
        ${row("Avg rating", (s) => (s.avg_rating === null ? "–" : `${num(s.avg_rating.toFixed(1))}★`))}
        ${row("Chain / indie", (s) => num(`${s.chain_count} / ${s.independent_count}`))}
      </tbody>
    </table>
    ${scoreLine}`;
}
