import { CATEGORIES, escapeHtml, num } from "./format.js";
import { LENSES, score } from "./score.js";

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

// The detail drawer for one locality. Sections run from context to
// conclusion, and the recommendation comes last and largest.
export function drawerHtml(locality, { category, lens, meta, rank }) {
  const p = locality.properties;
  const formats = category ? [category] : Object.keys(CATEGORIES);
  const confidence = p.status === "scored" ? "" : `<span class="drawer-flag">Low confidence: ${num(p.total_pois)} ${p.total_pois === 1 ? "outlet" : "outlets"}</span>`;
  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close ${escapeHtml(p.name)} details">×</button>
      <h2 id="drawer-title" tabindex="-1">${escapeHtml(p.name)}</h2>
      <p class="drawer-type">${escapeHtml(p.market_type)} · ${p.corporation} ward ${num(p.ward_number)}${confidence}</p>
      ${p.aliases.length ? `<p class="drawer-aliases">Includes ${escapeHtml(list(p.aliases.slice(0, 4)))}</p>` : ""}
    </header>

    <section class="drawer-section">
      <dl class="figures">
        <div><dt>Residents</dt><dd>${num(p.population.toLocaleString("en-US"))}</dd></div>
        <div><dt>Residents per outlet</dt><dd>${p.residents_per_outlet === null ? "no outlets"
          : num(p.residents_per_outlet.toLocaleString("en-US"))}
          <span class="versus">city median ${num(meta.city.residents_per_outlet.toLocaleString("en-US"))}</span></dd></div>
      </dl>
    </section>

    <section class="drawer-section">
      <h3>Cafes and QSRs here</h3>
      ${formatsTable(p, category)}
    </section>

    <section class="drawer-section">
      <h3>What's on the menu</h3>
      ${menuBar(p.menu)}
    </section>

    <section class="drawer-section">
      <h3>Chains and independents</h3>
      ${splitBar(p)}
    </section>

    <section class="drawer-section">
      <h3>Open late</h3>
      <p>${lateNight(p)}</p>
    </section>

    ${capacity(p, meta)}
    ${formats.map((c) => standing(p, c, lens, rank)).join("")}

    <section class="drawer-section">
      <h3>Similar wards</h3>
      <div class="chips">${p.similar.map((name) =>
        `<button class="chip" data-action="open-locality" data-value="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>
    </section>

    <p class="verdict">${escapeHtml(p.recommendation)}</p>`;
}

// Both formats side by side, the one being opened highlighted: a QSR
// founder still wants to know how crowded the cafe scene is.
function formatsTable(p, category) {
  const keys = Object.keys(CATEGORIES);
  const chosen = (key) => (key === category ? ' class="chosen"' : "");
  const row = (label, value) =>
    `<tr><th scope="row">${label}</th>${keys.map((key) => `<td${chosen(key)}>${value(p.categories[key])}</td>`).join("")}</tr>`;
  return `
    <table class="formats">
      <thead><tr><td></td>${keys.map((key) => `<th scope="col"${chosen(key)}>${CATEGORIES[key].label}</th>`).join("")}</tr></thead>
      <tbody>
        ${row("Outlets", (s) => num(s.count))}
        ${row("Per 10k residents", (s) => num(s.per_10k.toFixed(2)))}
        ${row("Chains", (s) => num(s.chain_count))}
      </tbody>
    </table>`;
}

function list(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function menuBar(menu) {
  const parts = MENU.filter(([kind]) => menu[kind]).map(([kind, color]) => ({ kind, color, share: menu[kind] }));
  const segments = parts.map((part) =>
    `<span style="width:${part.share * 100}%; background:${part.color}" title="${part.kind} ${Math.round(part.share * 100)}%"></span>`);
  const keys = parts.map((part) =>
    `<li><span class="key" style="background:${part.color}"></span>${part.kind} ${num(`${Math.round(part.share * 100)}%`)}</li>`);
  return `<div class="stack" role="img" aria-label="Menu mix: ${parts.map((part) =>
    `${part.kind} ${Math.round(part.share * 100)}%`).join(", ")}">${segments.join("")}</div><ul class="stack-keys">${keys.join("")}</ul>`;
}

function splitBar(p) {
  const chains = Object.values(p.categories).reduce((sum, c) => sum + c.chain_count, 0);
  const independents = p.total_pois - chains;
  const share = chains / p.total_pois;
  return `
    <div class="stack" role="img" aria-label="${chains} chain and ${independents} independent outlets">
      <span style="width:${share * 100}%; background:#7C8CA3"></span>
      <span style="width:${(1 - share) * 100}%; background:#4A4F57"></span>
    </div>
    <ul class="stack-keys">
      <li><span class="key" style="background:#7C8CA3"></span>Chain ${num(chains)}</li>
      <li><span class="key" style="background:#4A4F57"></span>Independent ${num(independents)}</li>
    </ul>`;
}

// OSM opening hours are sparse, so say how many outlets the share rests on.
function lateNight(p) {
  if (p.late_night_share === null) return "No opening hours are recorded for outlets here.";
  return `${num(`${Math.round(p.late_night_share * 100)}%`)} of the ${num(p.hours_known)}
    ${p.hours_known === 1 ? "outlet" : "outlets"} with recorded hours stay open past 11 pm.`;
}

// The capacity model: how much food and drink trade wards with these
// surroundings support, as a band against the city's median ward.
function capacity(p, meta) {
  const [low, mid, high] = p.capacity.multiplier;
  const helped = p.capacity.drivers.filter((d) => d.effect > 0).map((d) => d.phrase);
  const held = p.capacity.drivers.filter((d) => d.effect < 0).map((d) => d.phrase);
  const drivers = [
    helped.length ? `Helped by ${list(helped)}.` : "",
    held.length ? `Held back by ${list(held)}.` : "",
  ].join(" ");
  const expected = Math.round(p.total_pois + p.capacity.gap);
  const gap = expected > p.total_pois
    ? `Wards like this hold about ${num(expected)} outlets; it has ${num(p.total_pois)}.`
    : `It already has ${num(p.total_pois)} outlets, about what wards like it hold (${num(expected)}).`;
  return `
    <section class="drawer-section">
      <h3>What the surroundings support</h3>
      <p class="estimate">${num(`${mid.toFixed(1)}×`)} the city's median ward
        <span class="versus">80% range ${num(`${low.toFixed(1)}×`)}–${num(`${high.toFixed(1)}×`)} · ${escapeHtml(meta.capacity_label)}</span></p>
      <p class="drivers">${gap} ${drivers}</p>
    </section>`;
}

function standing(p, category, lens, rank) {
  const lensName = LENSES[lens ?? "footfall"].name.toLowerCase();
  const points = score(p, category, LENSES[lens ?? "footfall"].weights);
  const position = rank ? ` · ${num(`#${rank.position}`)} of ${num(rank.of)} confident wards` : "";
  return `<p class="drawer-score">${CATEGORIES[category].label} score ${num(points.toFixed(1))} for ${lensName}${position}</p>`;
}
