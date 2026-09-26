import { escapeHtml, num } from "./format.js";

// "How it works": what each model does, how it was checked, and its real
// numbers, read from the pipeline's model_report.json.
export function methodHtml(report) {
  if (!report) {
    return `
      ${head()}
      <p class="status">The model report didn't load. The map and shortlist still work; reload to try again.</p>`;
  }
  const { footfall, market_types: types } = report;
  const rows = Object.entries(footfall.candidates).map(([name, m]) => `
    <tr${name === footfall.chosen ? ' class="chosen"' : ""}>
      <th scope="row">${escapeHtml(name[0].toUpperCase() + name.slice(1))}</th>
      <td>${num(m.mae.toFixed(2))}</td><td>${num(m.r2.toFixed(2))}</td><td>${num(m.spearman.toFixed(2))}</td>
    </tr>`);
  const effects = footfall.effects.slice(0, 5).map((e) =>
    `<li>${escapeHtml(e.label)}: ${num(`${e.per_sd > 0 ? "+" : "−"}${Math.abs(e.per_sd).toFixed(2)}`)}</li>`);
  const kinds = types.types.map((t) => `<li>${escapeHtml(t.name)}: ${num(t.localities.length)} localities</li>`);

  return `
    ${head()}
    <section class="drawer-section">
      <h3>1. Footfall model</h3>
      <p>Predicts how many Google reviews a new outlet would collect, as a stand-in for footfall, from the
        outlet's type and what's around it. It supplies the demand part of every score.</p>
      <p>Checked by hiding whole localities from training (${escapeHtml(footfall.validation)}), so each error
        below is on places the model had never seen:</p>
      <table class="method-table">
        <thead><tr><td></td><th scope="col">Error</th><th scope="col">R²</th><th scope="col">Rank corr.</th></tr></thead>
        <tbody>${rows.join("")}</tbody>
      </table>
      <p class="note">Error is mean absolute error in log reviews; lower is better. Ridge is used because it
        beats the baseline. The fit is modest, so every estimate in the app comes with its 80% range.</p>
      <p>Biggest effects, in log reviews per standard deviation:</p>
      <ul class="plain">${effects.join("")}</ul>
    </section>
    <section class="drawer-section">
      <h3>2. Market types</h3>
      <p>k-means groups the ${num(footfall.localities)} localities by their food-and-drink profile. It picked
        ${num(types.k)} types with a silhouette of ${num(types.silhouette.toFixed(2))}, which means the groups
        overlap: they label a place, they don't score it.</p>
      <ul class="plain">${kinds.join("")}</ul>
    </section>
    <section class="drawer-section">
      <h3>What isn't a model</h3>
      <p>Menu types come from a brand table and name keywords. The final score is a fixed formula over the
        model's demand, outlets per 10,000 residents and competitor ratings; the lenses only change its weights.</p>
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
