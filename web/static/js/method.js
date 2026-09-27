import { escapeHtml, num } from "./format.js";

// "How it works": what each model does, how it was checked, its real
// numbers and what it can't do, read from the pipeline's model_report.json.
export function methodHtml(report) {
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
    </section>`;
}

function head() {
  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close how it works">×</button>
      <h2 id="drawer-title" tabindex="-1">How it works</h2>
      <p class="drawer-type">Machine learning in Localio, and how it was checked</p>
    </header>`;
}
