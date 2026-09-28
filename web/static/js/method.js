import { escapeHtml, num, percent, rupees } from "./format.js";

// "How it works": what each model does, how it was checked, its real
// numbers and what it can't do, read from the pipeline's model_report.json,
// then the money layer's formulas with every constant's source, read from
// economics.json.
export function methodHtml(report, econ) {
  if (!report) {
    return `
      ${head()}
      <p class="status">The model report didn't load. The map and shortlist still work; reload to try again.</p>`;
  }
  const { capacity, market_types: types } = report;
  const rows = Object.entries(capacity.candidates).map(([name, m]) => `
    <tr${name === capacity.chosen ? ' class="chosen"' : ""}>
      <th scope="row">${escapeHtml(name[0].toUpperCase() + name.slice(1))}</th>
      <td>${num(m.mae.toFixed(2))}</td><td>${num(m.r2.toFixed(2))}</td>
      <td>${m.coverage === undefined ? "–" : num(`${Math.round(m.coverage * 100)}%`)}</td>
    </tr>`);
  const features = capacity.features.map((f) => escapeHtml(f.label)).join(", ");
  const effects = capacity.effects.slice(0, 4).map((e) =>
    `<li>${escapeHtml(e.label)}: ${num(`${e.per_sd > 0 ? "+" : "−"}${Math.abs(e.per_sd).toFixed(2)}`)}</li>`);
  const kinds = types.types.map((t) => `<li>${escapeHtml(t.name)}: ${num(t.localities.length)} wards</li>`);
  const signal = capacity.label === "estimate" ? "an estimate" : `a ${escapeHtml(capacity.label)}`;

  return `
    ${head()}
    <section class="drawer-section">
      <h3>1. Capacity model, used as ${signal}</h3>
      <p>${escapeHtml(capacity.why_not_footfall)} It predicts outlets per km² for each of the ${num(capacity.wards)}
        wards from: ${features}. None of these is derived from the outlets themselves.</p>
      <p>Checked ${escapeHtml(capacity.validation)}, so every error below is for a ward the model didn't see.
        Linear quantile regression gives a p10, p50 and p90 for each ward.</p>
      <table class="method-table">
        <thead><tr><td></td><th scope="col">Error</th><th scope="col">R²</th><th scope="col">In p10–p90</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      <p class="note">Error is mean absolute error in log outlets per km²; lower is better. Below an R² of 0.25 the
        output is labelled a directional signal: it ranks wards, it doesn't forecast them.</p>
      <p>Biggest effects, per standard deviation:</p>
      <ul class="plain">${effects.join("")}</ul>
      <p class="note">What it can't do: ${escapeHtml(capacity.cannot)}</p>
    </section>
    <section class="drawer-section">
      <h3>2. Market types</h3>
      <p>k-means groups the wards by their food-and-drink profile. It picked ${num(types.k)} types with a silhouette of
        ${num(types.silhouette.toFixed(2))}: the groups overlap, so they label a ward, they don't score it.</p>
      <ul class="plain">${kinds.join("")}</ul>
    </section>
    <section class="drawer-section">
      <h3>What isn't a model</h3>
      <p>Wards come from DataMeet's 2012 boundaries and every outlet is placed by point-in-polygon in PostGIS.
        Menu types come from OSM cuisine tags and name keywords. The score is a fixed formula; the lenses only change
        its weights.</p>
    </section>
    ${econ ? moneyMethod(econ) : ""}`;
}

// The unit economics written out, then every constant with its basis and
// source, so nothing in a projection is unexplained.
function moneyMethod(econ) {
  const rows = Object.values(econ.sources).map((b) => `
    <tr>
      <th scope="row">${escapeHtml(b.key.replaceAll("_", " "))}</th>
      <td>${num(value(b.low, b.unit))}${b.high !== b.low ? `–${num(value(b.high, b.unit))}` : ""}</td>
      <td>${b.url ? `<a href="${escapeHtml(b.url)}" target="_blank" rel="noopener">${escapeHtml(b.source)}</a>`
        : escapeHtml(b.source)}${b.basis === "published" ? "" : ` <span class="basis">(${escapeHtml(b.basis)})</span>`}</td>
    </tr>`);
  const tiers = Object.entries(econ.rent.tiers).map(([tier, t]) => `<li>${escapeHtml(tier)}: ${num(`${t.multiplier}×`)}
    ${t.streets.length ? `(${t.streets.map((st) => `${escapeHtml(st.street)} ₹${st.rent_psf}`).join(", ")})` : "(no published street)"}</li>`);
  const fixed = Object.entries(econ.formats).map(([key, f]) => `${escapeHtml(key.replace("_", " "))} ${num(rupees(f.fixed))}`);
  return `
    <section class="drawer-section">
      <h3>3. The money: unit economics, not a model</h3>
      <p>For each ward and format, every figure is a p10–p90 range:</p>
      <ul class="plain formula">
        <li>revenue = format baseline × footfall × competition</li>
        <li>footfall = capacity multiplier^${num(econ.footfall.elasticity)}, kept within ${num(econ.footfall.clip[0])}–${num(econ.footfall.clip[1])}×</li>
        <li>competition = ((1 + city per 10k) ÷ (1 + ward per 10k))^${num(econ.competition.elasticity)}, within
          ${num(econ.competition.clip[0])}–${num(econ.competition.clip[1])}×</li>
        <li>rent = baseline ₹/sq ft × rent tier × sq ft</li>
        <li>costs = rent + (food ${num(percent(econ.rates.food_cost, 1))} + staff ${num(percent(econ.rates.staff))}
          + royalty) × revenue + fixed</li>
        <li>profit = revenue − costs; payback = setup ÷ profit</li>
      </ul>
      <p>No payback is shown when the p10 profit isn't positive, or when payback would run past
        ${num(econ.payback_cap)} months. Rent burden above ${num(percent(econ.rent.flag))} of revenue is flagged.</p>
      <p>Rent tiers are each tier's mean published rent over the mid tier's:</p>
      <ul class="plain">${tiers.join("")}</ul>
      <p class="note">Fixed costs have no published figure. They are set so a mid-tier ward at the default size and rent
        earns the published net-margin midpoint: ${fixed.join(", ")} a month.</p>
      <table class="method-table sources">
        <thead><tr><td></td><th scope="col">Value</th><th scope="col">Source</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      <p class="note">Anything marked as an assumption has no published source. The projections are directional
        and not investment advice.</p>
    </section>`;
}

function value(v, unit) {
  if (unit.startsWith("INR/month") || unit === "INR") return rupees(v);
  if (unit === "share of revenue") return percent(v);
  if (unit.startsWith("INR/sq ft")) return `₹${v}`;
  return String(v);
}

function head() {
  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close how it works">×</button>
      <h2 id="drawer-title" tabindex="-1">How it works</h2>
      <p class="drawer-type">Machine learning in Localio, and how it was checked</p>
    </header>`;
}
