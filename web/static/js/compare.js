import { CATEGORIES, escapeHtml, num, rupees } from "./format.js";
import { briefName, competitionLevel, monthlyRent, parts, roundedParts } from "./score.js";

export const SLOTS = 3;

// Up to three wards side by side for the current brief: the score and its
// parts, rent, and the figures behind them. Each column's ward can be
// swapped for any other, and the best value in a row is marked.
export function compareHtml(names, { wards, meta, rent, plan }) {
  const c = CATEGORIES[plan.category];
  const reference = meta.score.reference_per_10k[plan.category];
  const [, high] = rent.healthy_share;
  const chosen = names.map((name) => wards.find((f) => f.properties.name === name)).filter(Boolean);
  const cols = chosen.map((ward) => {
    const p = ward.properties;
    const score = parts(p, plan.category, plan.weights);
    return { p, score, points: roundedParts(score.items), rent: monthlyRent(rent, p, plan.sqft) };
  });
  const sorted = [...wards].sort((a, b) => a.properties.name.localeCompare(b.properties.name));
  const pickers = cols.map(({ p }, i) => `
    <label class="compare-pick"><span class="visually-hidden">Ward ${i + 1}</span>
      <select data-compare-slot="${i}">${sorted.map(({ properties: w }) =>
        `<option ${w.name === p.name ? "selected" : ""}>${escapeHtml(w.name)}</option>`).join("")}</select></label>`);

  // label, a value per column, and which way is better (1 higher, -1 lower)
  const rows = [
    ["Score /100", cols.map((col) => Math.round(col.score.total)), 1],
    ...cols[0].score.items.map((item, j) => [`${item.label}`, cols.map((col) => col.points[j]), 1, "part"]),
    [`Rent, ${num(plan.sqft)} sq ft`, cols.map((col) => col.rent), -1, "rupees"],
    ["Sales needed a month", cols.map((col) => Math.round(col.rent / high)), -1, "rupees"],
    ["Residents", cols.map((col) => col.p.population), 1, "count"],
    [`${c.label}s mapped`, cols.map((col) => col.p.categories[plan.category].count), -1],
    ["Competition", cols.map((col) => competitionLevel(col.p, plan.category, reference))],
    ["Offices, colleges, stations", cols.map((col) => `${col.p.draws.offices} · ${col.p.draws.colleges} · ${col.p.draws.stations}`)],
    ["Rent tier", cols.map((col) => `${col.p.rent.tier}${col.p.rent.estimated ? "*" : ""}`)],
    ["Data", cols.map((col) => (col.p.status === "scored" ? "good" : "thin"))],
  ];
  const body = rows.map(([label, values, better, kind]) => {
    const best = better && new Set(values).size > 1 ? (better > 0 ? Math.max(...values) : Math.min(...values)) : null;
    const cells = values.map((value) => {
      const text = kind === "rupees" ? rupees(value) : kind === "count" ? value.toLocaleString("en-US") : value;
      return `<td class="${value === best ? "best" : ""}${typeof value === "number" ? " num" : ""}">${text}</td>`;
    });
    return `<tr class="${kind === "part" ? "part-row" : ""}"><th scope="row">${label}</th>${cells.join("")}</tr>`;
  });
  const leader = [...cols].sort((a, b) => b.score.total - a.score.total)[0];
  const cheapest = [...cols].sort((a, b) => a.rent - b.rent)[0];
  const summary = leader === cheapest
    ? `${escapeHtml(leader.p.name)} scores highest and is the cheapest of these.`
    : `${escapeHtml(leader.p.name)} scores highest; ${escapeHtml(cheapest.p.name)} is the cheapest.`;

  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close the comparison">×</button>
      <h2 id="drawer-title" tabindex="-1">Compare wards</h2>
      <p class="drawer-type">For a ${c.one}: ${escapeHtml(briefName(plan.weights))}</p>
    </header>
    <div class="compare-pickers">${pickers.join("")}</div>
    <div class="compare-scroll">
      <table class="compare-table">
        <thead><tr><td></td>${cols.map(({ p }) =>
          `<th scope="col"><button class="text-button" data-action="open-ward" data-value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</button></th>`).join("")}</tr></thead>
        <tbody>${body.join("")}</tbody>
      </table>
    </div>
    <p class="verdict">${summary}</p>
    <p class="note">Best in each row is highlighted. Sales needed keeps rent at ${Math.round(high * 100)}% of sales.
      * Rent tier estimated from nearby wards.</p>`;
}
