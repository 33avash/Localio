import { CATEGORIES, escapeHtml, num, plural, rupees } from "./format.js";
import { competitionLevel, LENSES, monthlyRent, score } from "./score.js";

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

// One ward, in reading order: what it would cost, why it ranks where it
// does, what's already on the menu, the recommendation, then the sources.
export function drawerHtml(ward, { category, lens, sqft, meta, rent, rank }) {
  const p = ward.properties;
  const flag = p.status === "scored" ? "" : ` <span class="chip-flag">Only ${plural(p.total_pois, "outlet", "outlets")}: low confidence</span>`;
  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close ${escapeHtml(p.name)} details">×</button>
      <h2 id="drawer-title" tabindex="-1">${escapeHtml(p.name)}</h2>
      <p class="drawer-type">${p.corporation} ward ${num(p.ward_number)}${flag}</p>
      ${p.aliases.length ? `<p class="drawer-aliases">Includes ${escapeHtml(list(p.aliases.slice(0, 4)))}</p>` : ""}
    </header>
    ${rentSection(p, rent, sqft)}
    ${whySection(p, category, lens, meta, rank)}
    <section class="drawer-section">
      <h3>On the menu already</h3>
      ${menuBar(p.menu)}
    </section>
    <p class="verdict">${escapeHtml(p.recommendation)}</p>
    ${footer(p, meta, rent)}`;
}

// Rent for the shop size on the shortlist, and the sales that keep it
// within the healthy share restaurant guides give.
function rentSection(p, rent, sqft) {
  const monthly = monthlyRent(rent, p, sqft);
  const [low, high] = rent.healthy_share;
  const tier = p.rent.estimated
    ? `${p.rent.tier} tier, estimated from nearby wards`
    : `${p.rent.tier} tier: on ${escapeHtml(list(p.rent.streets))}`;
  return `
    <section class="drawer-section">
      <h3>Rent for a ${num(sqft)} sq ft shop</h3>
      <p class="hero"><span class="num">${rupees(monthly)}</span><span class="hero-unit">a month</span></p>
      <p class="hero-note">${tier}</p>
      <p class="body-text">To keep rent to a healthy ${Math.round(low * 100)}–${Math.round(high * 100)}% of sales, you'd
        need ${num(rupees(monthly / high))}–${num(rupees(monthly / low))} a month in sales.</p>
    </section>`;
}

function whySection(p, category, lens, meta, rank) {
  const formats = category ? [category] : Object.keys(CATEGORIES);
  const competition = formats.map((c) => {
    const stats = p.categories[c];
    const level = competitionLevel(p, c, meta.city.per_10k[c]);
    return figure(`${CATEGORIES[c].label}s per 10,000 residents`, stats.per_10k.toFixed(2),
      `${stats.count} here · city median ${meta.city.per_10k[c].toFixed(2)} · ${level === "none" ? "no" : level} competition`);
  });
  const draws = p.draws;
  const standing = category && lens
    ? `<p class="note">Score ${num(score(p, category, LENSES[lens].weights).toFixed(0))} out of 100 for
        ${LENSES[lens].name.toLowerCase()}${rank ? `: ${num(`#${rank.position}`)} of ${num(rank.of)} wards` : ""}.</p>`
    : "";
  return `
    <section class="drawer-section">
      <h3>Why it ranks here</h3>
      <dl class="figures">
        ${figure("Busyness", `${Math.round(p.demand * 100)}/100`, "how it ranks on the three below, against other wards")}
        ${figure("Residents per km²", p.residents_per_km2.toLocaleString("en-US"), `${p.population.toLocaleString("en-US")} residents`)}
        ${figure("Food and drink per km²", p.outlets_per_km2.toFixed(1), `${p.total_pois} outlets of every kind`)}
        ${figure("Offices, colleges and stations", draws.offices + draws.colleges + draws.stations,
          `${draws.offices} offices, ${draws.colleges} colleges, ${draws.stations} stations`)}
        ${competition.join("")}
      </dl>
      ${standing}
    </section>`;
}

function figure(label, value, detail) {
  return `<div><dt>${label}</dt><dd><span class="num">${value}</span><span class="range">${detail}</span></dd></div>`;
}

// Where the numbers come from, small and quiet: caveats, not the story.
function footer(p, meta, rent) {
  return `
    <footer class="drawer-foot">
      <p>Outlets: ${escapeHtml(meta.vintage.outlets)}. Residents: ${escapeHtml(p.population_method)}.
        Wards: ${escapeHtml(meta.vintage.wards)}.</p>
      <p>Rent: median of ${num(rent.listings)} Pune shop listings (₹${rent.typical_psf}/sq ft), times the tier from
        Cushman &amp; Wakefield's high-street rents. A guide, not a quote.</p>
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
