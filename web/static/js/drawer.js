import { defaults, projectLocality } from "./economics.js";
import { capitalise, CATEGORIES, escapeHtml, num, percent, rupeeRange, rupees, SIZE_LABELS } from "./format.js";
import { ASSUMPTIONS } from "./panel.js";
import { competition, LENSES, score } from "./score.js";

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

// The detail drawer for one ward, in reading order: who it is, the money,
// why, what's missing, the recommendation as the conclusion, then how
// much to trust it.
export function drawerHtml(locality, { category, lens, meta, econ, inputs, rank }) {
  const p = locality.properties;
  const confidence = p.status === "scored" ? "" : `<span class="chip-flag">Low confidence: ${num(p.total_pois)} ${p.total_pois === 1 ? "outlet" : "outlets"}</span>`;
  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close ${escapeHtml(p.name)} details">×</button>
      <h2 id="drawer-title" tabindex="-1">${escapeHtml(p.name)}</h2>
      <p class="drawer-type"><span class="chip-type">${escapeHtml(p.market_type)}</span>
        ${p.corporation} ward ${num(p.ward_number)}${confidence}</p>
      ${p.aliases.length ? `<p class="drawer-aliases">Includes ${escapeHtml(list(p.aliases.slice(0, 4)))}</p>` : ""}
    </header>

    ${category ? moneySection(p, category, econ, inputs, meta) : bothFormats(p, econ, meta)}

    <section class="drawer-section">
      <h3>Why</h3>
      ${why(p, category, meta, lens, rank)}
    </section>

    <section class="drawer-section">
      <h3>What's missing</h3>
      <p class="sub">What's on the menu</p>
      ${menuBar(p.menu)}
      <p class="sub">Chains and independents</p>
      ${splitBar(p)}
      <p class="sub">Open late</p>
      <p class="body-text">${lateNight(p)}</p>
    </section>

    <p class="verdict">${escapeHtml(p.recommendation)}</p>

    <section class="drawer-similar">
      <h3>Compare with similar wards</h3>
      <div class="chips">${p.similar.map((name) =>
        `<button class="chip" data-action="open-locality" data-value="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>
    </section>

    ${footer(p, meta)}`;
}

// The money, led by projected revenue at hero size: the p50 in full
// weight, the p10–p90 bounds quieter underneath.
function moneySection(p, category, econ, inputs, meta) {
  const m = projectLocality(econ, category, inputs, p, meta.city.per_10k[category]);
  const [rLow, rMid, rHigh] = m.revenue;
  const healthy = !m.rent_flag;
  const payback = m.payback
    ? `<dd><span class="num strong">${Math.round(m.payback[1])}</span> months
        <span class="range">${num(Math.round(m.payback[0]))}–${num(Math.round(m.payback[2]))} months</span></dd>`
    : `<dd class="caveat">${escapeHtml(capitalise(m.payback_note))}</dd>`;
  return `
    <section class="drawer-section money" aria-label="Projected money">
      <h3>Projected revenue, a month</h3>
      <p class="hero"><span class="num">${rupees(rMid)}</span><span class="hero-unit">/mo</span></p>
      <p class="hero-range"><span class="num">${rupees(rLow)} – ${rupees(rHigh)}</span> · 80% range</p>
      <dl class="figures">
        <div><dt>Profit a month</dt>
          <dd>${rupeeRange(m.profit[0], m.profit[2])}<span class="range">p50 ${num(rupees(m.profit[1]))}</span></dd></div>
        <div><dt>Payback on ${num(rupees(inputs.setup))}</dt>${payback}</div>
        <div><dt>Rent burden</dt>
          <dd><span class="num strong ${healthy ? "pos" : "neg"}">${percent(m.rent_burden[1])}</span>
            <span class="range">${healthy ? "within" : "above"} the ${percent(econ.rent.flag)} flag ·
              ${num(percent(m.rent_burden[0]))}–${num(percent(m.rent_burden[2]))}</span></dd></div>
        <div><dt>Rent a month</dt>
          <dd><span class="num strong">${rupees(m.rent)}</span>
            <span class="range">${escapeHtml(p.rent.tier)} tier${p.rent.estimated ? " (estimated)" : ""} ·
              ${num(p.rent.multiplier.toFixed(2))}× baseline</span></dd></div>
      </dl>
      <p class="assumed">${capitalise(SIZE_LABELS[category][inputs.size])}, ${num(inputs.sqft)} sq ft, ₹${num(inputs.rent_psf)}/sq ft
        baseline · p50 net margin ${num(percent(m.margin[1]))} against your ${num(percent(inputs.target_margin, 1))} target ·
        <button class="text-button" data-action="goto" data-value="${ASSUMPTIONS}" data-close-drawer>Edit assumptions</button></p>
    </section>`;
}

// Before a format is picked, both formats' money side by side.
function bothFormats(p, econ, meta) {
  const rows = Object.keys(CATEGORIES).map((c) => {
    const m = projectLocality(econ, c, defaults(econ, c), p, meta.city.per_10k[c]);
    return `<tr><th scope="row">${CATEGORIES[c].label}</th><td>${rupeeRange(m.revenue[0], m.revenue[2])}</td>
      <td>${rupeeRange(m.profit[0], m.profit[2])}</td></tr>`;
  });
  return `
    <section class="drawer-section money" aria-label="Projected money">
      <h3>Projected a month, p10–p90, at default assumptions</h3>
      <table class="formats">
        <thead><tr><td></td><th scope="col">Revenue</th><th scope="col">Profit</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      <p class="assumed">Pick a format for the full projection.</p>
    </section>`;
}

function why(p, category, meta, lens, rank) {
  const keys = category ? [category] : Object.keys(CATEGORIES);
  const [low, mid, high] = p.capacity.multiplier;
  const perFormat = keys.map((c) => {
    const stats = p.categories[c];
    const city = meta.city.per_10k[c];
    const level = competition(p, c, city);
    return `<div><dt>${CATEGORIES[c].many[0].toUpperCase() + CATEGORIES[c].many.slice(1)} per 10k residents</dt>
      <dd><span class="num">${stats.per_10k.toFixed(2)}</span>
        <span class="range">${num(stats.count)} here · city median ${num(city.toFixed(2))} · ${level} competition</span></dd></div>`;
  });
  const standing = category && lens
    ? `<p class="note">${CATEGORIES[category].label} score ${num(score(p, category, LENSES[lens].weights).toFixed(1))} for
        ${LENSES[lens].name.toLowerCase()}${rank ? ` · ${num(`#${rank.position}`)} of ${num(rank.of)} confident wards` : ""}</p>`
    : "";
  return `
    <dl class="figures">
      <div><dt>Residents</dt><dd><span class="num">${p.population.toLocaleString("en-US")}</span></dd></div>
      <div><dt>Residents per outlet</dt><dd><span class="num">${p.residents_per_outlet === null ? "no outlets"
        : p.residents_per_outlet.toLocaleString("en-US")}</span>
        <span class="range">city median ${num(meta.city.residents_per_outlet.toLocaleString("en-US"))}</span></dd></div>
      ${perFormat.join("")}
      <div><dt>Footfall signal</dt><dd><span class="num">${mid.toFixed(1)}×</span>
        <span class="range">the median ward · 80% range ${num(`${low.toFixed(1)}–${high.toFixed(1)}×`)}</span></dd></div>
    </dl>
    ${drivers(p)}
    ${standing}`;
}

function drivers(p) {
  const helped = p.capacity.drivers.filter((d) => d.effect > 0).map((d) => d.phrase);
  const held = p.capacity.drivers.filter((d) => d.effect < 0).map((d) => d.phrase);
  const text = [helped.length ? `Helped by ${list(helped)}.` : "", held.length ? `Held back by ${list(held)}.` : ""]
    .join(" ").trim();
  return text ? `<p class="note">${text}</p>` : "";
}

// Model interval, data vintage and the rent tier's provenance, small and
// quiet: caveats, not the story.
function footer(p, meta) {
  const [low, , high] = p.capacity.multiplier;
  const tier = p.rent.estimated
    ? `Rent tier ${escapeHtml(p.rent.tier)} is an estimated tier: no published street runs through this ward, so it takes its admin zone's median.`
    : `Rent tier ${escapeHtml(p.rent.tier)} from published rents on ${escapeHtml(list(p.rent.streets))}.`;
  return `
    <footer class="drawer-foot">
      <p>Footfall comes from the capacity model, used as a ${escapeHtml(meta.capacity_label)}
        (R² ${num(meta.capacity_r2.toFixed(2))}); this ward's 80% interval is ${num(`${low.toFixed(1)}–${high.toFixed(1)}×`)}.</p>
      <p>${tier}</p>
      <p>Outlets: ${escapeHtml(meta.vintage.outlets)}. Wards: ${escapeHtml(meta.vintage.wards)}. Residents:
        ${escapeHtml(meta.vintage.population)}. Projections are directional, not investment advice.</p>
    </footer>`;
}

function list(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function menuBar(menu) {
  const parts = MENU.filter(([kind]) => menu[kind]).map(([kind, color]) => ({ kind, color, share: menu[kind] }));
  if (!parts.length) return '<p class="body-text">No outlets recorded here.</p>';
  const segments = parts.map((part) =>
    `<span style="width:${part.share * 100}%; background:${part.color}" title="${part.kind} ${Math.round(part.share * 100)}%"></span>`);
  const keys = parts.map((part) =>
    `<li><span class="key" style="background:${part.color}"></span>${part.kind} ${num(`${Math.round(part.share * 100)}%`)}</li>`);
  return `<div class="stack" role="img" aria-label="Menu mix: ${parts.map((part) =>
    `${part.kind} ${Math.round(part.share * 100)}%`).join(", ")}">${segments.join("")}</div><ul class="stack-keys">${keys.join("")}</ul>`;
}

function splitBar(p) {
  if (!p.total_pois) return '<p class="body-text">No outlets recorded here.</p>';
  const chains = Math.round((p.chain_share ?? 0) * p.total_pois);
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
