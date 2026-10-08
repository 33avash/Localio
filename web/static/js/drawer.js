import { CATEGORIES, escapeHtml, num, rupees } from "./format.js";
import { caseFor, confidence, fitBand, freshness, sensitivity } from "./insight.js";
import { partsBar } from "./panel.js";
import { briefName, competitionLevel, monthlyRent, parts, roundedParts, standing } from "./score.js";

// Menu types in the order the stacked bar draws them, each with a muted
// colour that stays clear of the accent and the density ramp.
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

// The scenario calculator's starting assumptions. They're the user's to
// change, and labelled as assumptions on the page.
export const CALC_DEFAULTS = { ticket: 250, days: 30, share: 0.1 };

// One ward, as an analyst would brief it: the verdict and how far to trust
// it, the case for and against, how the score adds up, the economics, how
// stable the rank is, what's around, and where every number comes from.
export function drawerHtml(ward, { plan, meta, rent, wards, position, of }) {
  const p = ward.properties;
  const c = CATEGORIES[plan.category];
  const score = parts(p, plan.category, plan.weights);
  const monthly = monthlyRent(rent, p, plan.sqft);
  const conf = confidence(p, meta);
  const band = fitBand(score.total);
  const flag = p.status === "scored" ? ""
    : `<p class="flag">Only ${num(p.total_pois)} outlets are mapped here, so treat these numbers as a lead to check on the ground.</p>`;
  const standingText = position ? `#${position} of ${of} wards that fit your brief` : "Not in your top 5";
  const budget = plan.budget
    ? `<p class="${monthly <= plan.budget ? "ok" : "over"}">${monthly <= plan.budget ? "Within" : `${rupees(monthly - plan.budget)} over`}
        your ${rupees(plan.budget)} ceiling.</p>` : "";
  const why = caseFor(p, { plan, meta, rent });
  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close ${escapeHtml(p.name)} details">×</button>
      <p class="eyebrow">${p.corporation} ward ${p.ward_number}${p.aliases.length ? ` · includes ${escapeHtml(list(p.aliases.slice(0, 3)))}` : ""}</p>
      <h2 id="drawer-title" tabindex="-1">${escapeHtml(p.name)}</h2>
      ${flag}
    </header>

    <div class="stats">
      <section class="stat">
        <h3>Score · ${c.one}</h3>
        <p class="stat-value"><span class="num">${Math.round(score.total)}</span><span class="stat-unit">/100</span></p>
        <p class="stat-fit">${band.label}</p>
        ${partsBar(score.items)}
        <p class="stat-note">${standingText}</p>
        <p class="conf-line"><span class="conf conf-${conf.level.toLowerCase()}">${conf.level} confidence</span></p>
      </section>
      <section class="stat">
        <h3>Rent · ${plan.sqft} sq ft</h3>
        <p class="stat-value"><span class="num">${rupees(monthly)}</span><span class="stat-unit">/month</span></p>
        <p class="stat-note">${num(`₹${Math.round(rent.typical_psf * p.rent.multiplier)}`)} per sq ft · ${p.rent.tier} tier${p.rent.estimated ? " (zone estimate)" : ""}</p>
        ${budget}
      </section>
    </div>

    <section class="drawer-section" aria-labelledby="why-title">
      <h3 id="why-title">Why this location</h3>
      <div class="case">
        <div class="case-col"><h4>The case</h4>${caseList(why.strengths, "plus", "No standout strengths for this brief.")}</div>
        <div class="case-col"><h4>Watch out</h4>${caseList(why.risks, "minus", "Nothing in the data stands out.")}</div>
      </div>
      <p class="conf-line" style="margin-top:12px"><span class="conf-why">Confidence is ${conf.level.toLowerCase()}:
        ${escapeHtml(conf.reasons.length ? conf.reasons.join("; ") : "well-mapped outlets, voter-roll residents and a published rent")}.</span></p>
    </section>

    ${breakdown(p, plan, meta, score)}

    ${economics(p, plan, rent, monthly)}

    ${stability(p, { wards, plan, rent })}

    <section class="drawer-section" aria-labelledby="around-title">
      <h3 id="around-title">What draws people here</h3>
      <dl class="facts">
        <div><dt>Offices</dt><dd>${num(p.draws.offices)}</dd></div>
        <div><dt>Colleges</dt><dd>${num(p.draws.colleges)}</dd></div>
        <div><dt>Stations</dt><dd>${num(p.draws.stations)}</dd></div>
        <div><dt>Residents</dt><dd>${num(p.population.toLocaleString("en-US"))}</dd></div>
        <div><dt>Area</dt><dd>${num(p.area_km2)}<span class="stat-unit"> km²</span></dd></div>
        <div><dt>${c.label}s mapped</dt><dd>${num(p.categories[plan.category].count)}</dd></div>
      </dl>
      ${p.aliases.length ? `<p class="places">Places in the ward: ${escapeHtml(list(p.aliases))}.</p>` : ""}
    </section>

    <section class="drawer-section">
      <h3>On the menu already</h3>
      ${menuBar(p.menu)}
    </section>

    <p class="verdict">${escapeHtml(p.recommendation)}</p>
    <div class="drawer-actions">
      <button class="secondary" data-action="compare-with" data-value="${escapeHtml(p.name)}">Compare with your top picks</button>
      <button class="secondary" data-action="ask-ward" data-value="${escapeHtml(p.name)}">Ask about ${escapeHtml(p.name)}</button>
    </div>

    ${quality(p, plan, meta, rent, monthly)}`;
}

function caseList(items, kind, none) {
  if (!items.length) return `<p class="case-empty">${none}</p>`;
  return `<ul class="case-list ${kind}">${items.map((item) =>
    `<li><span>${escapeHtml(item.text)}</span><span class="case-detail">${escapeHtml(item.detail)}</span></li>`).join("")}</ul>`;
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
        <th scope="row"><span class="th-key"><span class="key" style="background:${item.colour}"></span>${item.label}</span>
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
      <p class="note">Weights from your brief: ${escapeHtml(briefName(plan.weights))}. Each part adds 100 × its weight
        share × its value. Residents, eating out and daytime draw are the ward's standing among Pune's 140 wards; low
        competition is 0.5 at the rate in well-mapped wards, higher with fewer.</p>
    </section>`;
}

// Rent, and the sales it implies: arithmetic on the user's assumptions,
// labelled as such, never a forecast.
function economics(p, plan, rent, monthly) {
  const [low, high] = rent.healthy_share;
  const shares = [low, 0.1, 0.12, high];
  return `
    <section class="drawer-section" aria-labelledby="econ-title">
      <h3 id="econ-title">Economics</h3>
      <dl class="econ">
        <div><dt>Monthly rent</dt><dd>${rupees(monthly)}</dd></div>
        <div><dt>Rent per sq ft</dt><dd>₹${Math.round(rent.typical_psf * p.rent.multiplier)}</dd></div>
        <div><dt>Sales needed</dt><dd>${rupees(monthly / high)}–${rupees(monthly / low)}</dd></div>
      </dl>
      <p class="section-sub">Rent = ₹${rent.typical_psf}/sq ft (median of ${rent.listings} Pune listings) × ${p.rent.multiplier}
        (${p.rent.tier} tier${p.rent.estimated ? ", estimated from the ward's zone" : `, ${escapeHtml(p.rent.streets.join(", "))}`})
        × ${plan.sqft} sq ft. Sales needed keeps rent to ${Math.round(low * 100)}–${Math.round(high * 100)}% of sales.</p>
      <div class="calc" data-calc data-rent="${monthly}">
        <span class="calc-label">Scenario calculation · not a forecast</span>
        <div class="calc-inputs">
          <label class="field"><span class="field-label">Average ticket</span>
            <span class="input-unit"><span>₹</span><input type="number" min="10" step="10" value="${CALC_DEFAULTS.ticket}" data-calc-input="ticket"></span></label>
          <label class="field"><span class="field-label">Days open a month</span>
            <span class="input-unit"><input type="number" min="1" max="31" step="1" value="${CALC_DEFAULTS.days}" data-calc-input="days"></span></label>
          <label class="field"><span class="field-label">Rent share of sales</span>
            <select data-calc-input="share">${shares.map((s) =>
              `<option value="${s}" ${s === CALC_DEFAULTS.share ? "selected" : ""}>${Math.round(s * 100)}%</option>`).join("")}</select></label>
        </div>
        <dl class="calc-out" aria-live="polite">${calcRows(monthly, CALC_DEFAULTS)}</dl>
      </div>
    </section>`;
}

export function calcRows(monthly, { ticket, days, share }) {
  const sales = monthly / share;
  const daily = sales / days;
  return `
    <div><dt>Sales needed a month</dt><dd>${rupees(sales)}</dd></div>
    <div><dt>Sales needed a day</dt><dd>${rupees(daily)}</dd></div>
    <div><dt>Orders a day at ₹${Math.round(ticket)}</dt><dd>${Math.ceil(daily / ticket)}</dd></div>`;
}

// The ward's rank under nearby briefs, by the same scoring.
function stability(p, context) {
  const { byBudget, byCompetition, verdict } = sensitivity(p.name, context);
  const row = (r) => `<tr class="${r.current ? "current" : ""}"><th scope="row">${r.label}${r.current ? " (yours)" : ""}</th>
    <td>${r.rank ? `#${r.rank}` : `<span class="out">${escapeHtml(r.out)}</span>`}</td></tr>`;
  return `
    <section class="drawer-section" aria-labelledby="stable-title">
      <h3 id="stable-title">How stable is this rank?</h3>
      <div class="sens">
        <table class="sens-table"><caption>If your rent ceiling were</caption><tbody>${byBudget.map(row).join("")}</tbody></table>
        <table class="sens-table"><caption>If your competition tolerance were</caption><tbody>${byCompetition.map(row).join("")}</tbody></table>
      </div>
      <p class="sens-verdict">${escapeHtml(verdict)}</p>
    </section>`;
}

// Value, source, freshness and confidence for each figure the score uses.
function quality(p, plan, meta, rent, monthly) {
  const src = Object.fromEntries((meta.sources ?? []).map((s) => [s.id, s]));
  const built = meta.generated_at;
  const fmt = CATEGORIES[plan.category];
  const fresh = (id) => {
    if (!src[id]) return "";
    const f = freshness(src[id].as_of, built);
    return `${escapeHtml(f.label)} <span class="badge fresh-${f.level.toLowerCase()}">${f.level}</span>`;
  };
  const conf = confidence(p, meta).signals;
  const rows = [
    [`${fmt.label}s mapped`, `${p.categories[plan.category].count}`, "OpenStreetMap", fresh("outlets"), conf.outlets.ok ? "Medium" : "Low"],
    ["Offices · colleges · stations", `${p.draws.offices} · ${p.draws.colleges} · ${p.draws.stations}`, "OpenStreetMap", fresh("context"), "Medium"],
    ["Residents", p.population.toLocaleString("en-US"), p.population_method, fresh("population"), conf.residents.ok ? "Medium" : "Low"],
    ["Rent", rupees(monthly), p.rent.estimated ? "Zone tier (estimate)" : "Cushman & Wakefield street rent", fresh("rent_streets"), conf.rent.ok ? "Medium" : "Low"],
  ];
  return `
    <section class="drawer-section" aria-labelledby="quality-title">
      <h3 id="quality-title">Data quality</h3>
      <table class="data-table">
        <thead><tr><th scope="col" style="text-align:left">Figure · source</th><th scope="col">Value</th><th scope="col">As of</th><th scope="col">Trust</th></tr></thead>
        <tbody>${rows.map(([label, value, source, asOf, trust]) =>
          `<tr><th scope="row">${label}<span class="row-detail">${escapeHtml(source)}</span></th><td class="num">${escapeHtml(value)}</td><td>${asOf}</td><td>${trust}</td></tr>`).join("")}</tbody>
      </table>
      <p class="note">Outlets: ${escapeHtml(meta.vintage.outlets)}. Residents: ${escapeHtml(p.population_method)}.
        Wards: ${escapeHtml(meta.vintage.wards)}. Rent is a guide from published rents, not a quote.
        <button class="text-button" data-action="sources">All sources</button></p>
    </section>`;
}

function list(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function menuBar(menu) {
  const shown = MENU.filter(([kind]) => menu[kind]).map(([kind, color]) => ({ kind, color, share: menu[kind] }));
  if (!shown.length) return '<p class="section-sub">No outlets are mapped here yet.</p>';
  const segments = shown.map((part) =>
    `<span style="width:${part.share * 100}%; background:${part.color}" title="${part.kind} ${Math.round(part.share * 100)}%"></span>`);
  const keys = shown.map((part) =>
    `<li><span class="key" style="background:${part.color}"></span>${part.kind} ${num(`${Math.round(part.share * 100)}%`)}</li>`);
  return `<div class="stack" role="img" aria-label="Menu mix: ${shown.map((part) =>
    `${part.kind} ${Math.round(part.share * 100)}%`).join(", ")}">${segments.join("")}</div><ul class="stack-keys">${keys.join("")}</ul>`;
}
