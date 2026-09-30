import { CATEGORIES, escapeHtml, num, rupees } from "./format.js";
import { partsBar } from "./panel.js";
import { briefName, competitionLevel, monthlyRent, parts, roundedParts, standing } from "./score.js";

// Menu types in the order the stacked bar draws them, each with a muted
// colour that stays clear of the teal accent and the density ramp.
const MENU = [
  ["Coffee", "#8B6F5A"],
  ["Chai & tea", "#B8905F"],
  ["Bakery & desserts", "#B784A7"],
  ["Pizza & Italian", "#A95F58"],
  ["Burgers & fried chicken", "#C98A52"],
  ["Sandwiches & rolls", "#93A565"],
  ["Indian", "#C4A443"],
  ["Chinese & Asian", "#6FA3A0"],
  ["Other cuisine", "#8E7FA8"],
  ["Cafe, no cuisine tagged", "#7C8CA3"],
  ["QSR, no cuisine tagged", "#66707D"],
  ["Restaurant, no cuisine tagged", "#4E545C"],
];

// One ward: its score and rent up top, then every part of the score with
// the numbers behind it, what's there already, the recommendation and the
// sources.
export function drawerHtml(ward, { plan, meta, rent, position }) {
  const p = ward.properties;
  const c = CATEGORIES[plan.category];
  const score = parts(p, plan.category, plan.weights);
  const monthly = monthlyRent(rent, p, plan.sqft);
  const [low, high] = rent.healthy_share;
  const flag = p.status === "scored" ? ""
    : `<p class="flag">Only ${num(p.total_pois)} outlets are mapped here, so its numbers are a lead to check on the ground.</p>`;
  const standing = position ? `#${position} on your shortlist` : "Not in your top 5";
  const budget = plan.budget
    ? `<p class="${monthly <= plan.budget ? "ok" : "over"}">${monthly <= plan.budget ? "Within" : `${rupees(monthly - plan.budget)} over`}
        your ${rupees(plan.budget)} budget.</p>` : "";
  const tier = p.rent.estimated
    ? `${p.rent.tier} tier, estimated from nearby wards`
    : `${p.rent.tier} tier: on ${escapeHtml(list(p.rent.streets))}`;
  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close ${escapeHtml(p.name)} details">×</button>
      <h2 id="drawer-title" tabindex="-1">${escapeHtml(p.name)}</h2>
      <p class="drawer-type">${p.corporation} ward ${num(p.ward_number)}${p.aliases.length
        ? ` · includes ${escapeHtml(list(p.aliases.slice(0, 3)))}` : ""}</p>
      ${flag}
    </header>

    <div class="stats">
      <section class="stat">
        <h3>Score for your ${c.one}</h3>
        <p class="stat-value"><span class="num">${Math.round(score.total)}</span><span class="stat-unit">/100</span></p>
        ${partsBar(score.items)}
        <p class="stat-note">${standing}</p>
      </section>
      <section class="stat">
        <h3>Rent for ${num(plan.sqft)} sq ft</h3>
        <p class="stat-value"><span class="num">${rupees(monthly)}</span><span class="stat-unit">/month</span></p>
        <p class="stat-note">${tier}</p>
        ${budget}
      </section>
    </div>
    <p class="body-text">To keep rent to ${Math.round(low * 100)}–${Math.round(high * 100)}% of sales, you'd need
      ${num(rupees(monthly / high))}–${num(rupees(monthly / low))} a month in sales.</p>

    ${breakdown(p, plan, meta, score)}

    <section class="drawer-section">
      <h3>On the menu already</h3>
      ${menuBar(p.menu)}
    </section>

    <p class="verdict">${escapeHtml(p.recommendation)}</p>
    <div class="drawer-actions">
      <button class="secondary" data-action="compare-with" data-value="${escapeHtml(p.name)}">Compare with your top picks</button>
      <button class="secondary" data-action="ask-ward" data-value="${escapeHtml(p.name)}">Ask about ${escapeHtml(p.name)}</button>
    </div>

    <footer class="drawer-foot">
      <p>Outlets: ${escapeHtml(meta.vintage.outlets)}. Residents: ${escapeHtml(p.population_method)}.
        Wards: ${escapeHtml(meta.vintage.wards)}.</p>
      <p>Rent: median of ${num(rent.listings)} Pune shop listings (₹${rent.typical_psf}/sq ft) × the tier from
        Cushman &amp; Wakefield's high-street rents. A guide, not a quote.</p>
    </footer>`;
}

// Every part of the score: what it measures here, its value, its weight
// and the points it adds. The points column adds up to the score.
function breakdown(p, plan, meta, score) {
  const points = roundedParts(score.items);
  const reference = meta.score.reference_per_10k[plan.category];
  const level = competitionLevel(p, plan.category, reference);
  const rows = score.items.map((item, i) => {
    const detail = item.key === "room"
      ? `${item.measure(p, plan.category)}; ${reference.toFixed(2)} in well-mapped wards · ${level}`
      : `${item.measure(p, plan.category)} · ${standing(item.value)}`;
    return `
      <tr>
        <th scope="row"><span class="key" style="background:${item.colour}"></span>${item.label}
          <span class="row-detail">${escapeHtml(detail)}</span></th>
        <td class="num">${item.value.toFixed(2)}</td>
        <td class="num">${Math.round(item.share * 100)}%</td>
        <td class="num">${points[i]}</td>
      </tr>`;
  });
  return `
    <section class="drawer-section">
      <h3>How the score adds up</h3>
      <table class="parts-table">
        <thead><tr><td></td><th scope="col">0–1</th><th scope="col">Weight</th><th scope="col">Points</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
        <tfoot><tr><th scope="row">Score</th><td></td><td></td><td class="num">${Math.round(score.total)}</td></tr></tfoot>
      </table>
      <p class="note">Weights from your brief: ${escapeHtml(briefName(plan.weights))}. Residents, eating out and
        daytime draw are the ward's standing among Pune's 140 wards. Low competition is 0.5 at the rate in well-mapped
        wards, higher with fewer.</p>
    </section>`;
}

function list(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function menuBar(menu) {
  const shown = MENU.filter(([kind]) => menu[kind]).map(([kind, color]) => ({ kind, color, share: menu[kind] }));
  if (!shown.length) return '<p class="body-text">No outlets are mapped here yet.</p>';
  const segments = shown.map((part) =>
    `<span style="width:${part.share * 100}%; background:${part.color}" title="${part.kind} ${Math.round(part.share * 100)}%"></span>`);
  const keys = shown.map((part) =>
    `<li><span class="key" style="background:${part.color}"></span>${part.kind} ${num(`${Math.round(part.share * 100)}%`)}</li>`);
  return `<div class="stack" role="img" aria-label="Menu mix: ${shown.map((part) =>
    `${part.kind} ${Math.round(part.share * 100)}%`).join(", ")}">${segments.join("")}</div><ul class="stack-keys">${keys.join("")}</ul>`;
}
