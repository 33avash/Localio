import { CATEGORIES, escapeHtml, num, rupees } from "./format.js";
import { FIT_BREAKS, market } from "./insight.js";
import { briefName } from "./score.js";

// The fit bands' colours, matching the map.
const FIT = ["#CFE5D8", "#9CCBB2", "#62AC89", "#338766", "#175C45"];
const INK = "var(--text-2)";

// The whole city for the current brief: how wards spread across the fit
// bands, where competition stands, what rent costs, where the data is thin,
// and where the numbers point to an opening. Every figure is computed from
// the published ward data at the moment it's opened.
export function marketHtml(data) {
  const { plan, meta } = data;
  const m = market(data);
  const c = CATEGORIES[plan.category];
  const ranges = ["under 45", ...FIT_BREAKS.slice(0, -1).map((b, i) => `${b}–${FIT_BREAKS[i + 1] - 1}`), `${FIT_BREAKS.at(-1)}+`];
  const maxBand = Math.max(1, ...m.bands.map((b) => b.count));
  const maxLevel = Math.max(1, ...m.levels.map((l) => l.mapped + l.thin));
  const maxTier = Math.max(1, ...m.tiers.map((t) => t.count));
  const mapped = m.coverage.reduce((s, x) => s + x.mapped, 0);

  return `
    <header class="drawer-head">
      <button class="drawer-close" data-action="close-drawer" aria-label="Close the market overview">×</button>
      <p class="eyebrow">Market · Pune + Pimpri-Chinchwad</p>
      <h2 id="drawer-title" tabindex="-1">Market overview</h2>
      <p class="drawer-type">For a ${num(plan.sqft)} sq ft ${c.one}: ${escapeHtml(briefName(plan.weights))}</p>
    </header>

    <dl class="kpis">
      <div class="kpi"><dt>Wards</dt><dd>${m.total}<span class="kpi-sub">${m.fitting} fit your brief</span></dd></div>
      <div class="kpi"><dt>Mapped outlets</dt><dd>${meta.outlets.toLocaleString("en-US")}<span class="kpi-sub">${meta.category_counts.cafe} cafes · ${meta.category_counts.fast_food} QSRs</span></dd></div>
      <div class="kpi"><dt>Rent, ${plan.sqft} sq ft</dt><dd>${rupees(m.rent.median)}<span class="kpi-sub">median; ${rupees(m.rent.low)}–${rupees(m.rent.high)}</span></dd></div>
      <div class="kpi"><dt>Well mapped</dt><dd>${mapped}<span class="kpi-sub">wards with ${meta.min_outlets}+ outlets</span></dd></div>
    </dl>

    <div class="market-grid">
      <section aria-labelledby="mk-fit">
        <h3 id="mk-fit">Fit for your brief</h3>
        <ul class="bars">${[...m.bands].reverse().map((b) => bar(b.name, b.count, maxBand, FIT[b.index],
          `${b.name} (${ranges[b.index]}): ${b.count} wards`)).join("")}</ul>
        <p class="note">Wards that fit your brief, by score band. ${m.total - m.fitting} are left out by area, rent
          or thin data.</p>
      </section>

      <section aria-labelledby="mk-comp">
        <h3 id="mk-comp">${c.label} competition</h3>
        <ul class="bars">${m.levels.map((l) => stacked(l, maxLevel)).join("")}</ul>
        <ul class="chart-keys">
          <li><span class="swatch" style="background:${INK}"></span>${meta.min_outlets}+ outlets mapped</li>
          <li><span class="swatch hatch"></span>thin data</li>
        </ul>
        <p class="note">Against ${meta.score.reference_per_10k[plan.category].toFixed(2)} ${c.many} per 10k residents in
          well-mapped wards. In thin-data wards, "none" is usually a gap in the map.</p>
      </section>

      <section aria-labelledby="mk-rent">
        <h3 id="mk-rent">Rent tiers</h3>
        <ul class="bars">${[...m.tiers].sort((a, b) => b.multiplier - a.multiplier).map((t) =>
          bar(`${cap(t.name)} · ${rupees(t.monthly)}`, t.count, maxTier, INK, `${cap(t.name)} tier (${t.multiplier}×): ${t.count} wards, ${rupees(t.monthly)} a month for ${plan.sqft} sq ft`)).join("")}</ul>
        <p class="note">Wards per tier, with the monthly rent for your shop size. Only ${data.wards.filter((w) => !w.properties.rent.estimated).length}
          wards sit on a published high street; the rest take their zone's tier.</p>
      </section>

      <section aria-labelledby="mk-cov">
        <h3 id="mk-cov">Data coverage</h3>
        <ul class="bars">${m.coverage.map((x) =>
          bar(x.corp === "PMC" ? "Pune city" : "Pimpri-Chinchwad", x.mapped, x.wards, INK, `${x.mapped} of ${x.wards} wards well mapped`, `${x.mapped}/${x.wards}`)).join("")}
          ${m.conf.map((x) => bar(`${x.name} confidence`, x.count, m.total, INK, `${x.count} wards at ${x.name.toLowerCase()} confidence`)).join("")}</ul>
        <p class="note">Confidence combines outlet coverage, how residents were estimated and whether rent comes from a
          published street.</p>
      </section>
    </div>

    <section class="drawer-section" aria-labelledby="mk-signal" style="margin-top:24px">
      <h3 id="mk-signal">Opportunity signals</h3>
      <p class="section-sub">Well-mapped wards whose residents, eating out and daytime draw average in the top 40%,
        with light or no mapped ${c.many} competition${plan.budget ? ` and rent within ${rupees(plan.budget)}` : ""}.
        A signal to investigate, not a promise.</p>
      ${m.signals.length ? `<ul class="signal-list">${m.signals.slice(0, 8).map((s) => `
        <li><button data-action="open-ward" data-value="${escapeHtml(s.p.name)}">
          <span class="signal-name">${escapeHtml(s.p.name)}</span>
          <span class="signal-fig num">people ${Math.round(s.demand * 100)} · ${escapeHtml(s.level)}</span>
          <span class="signal-fig num">${rupees(s.rent)}/mo</span>
        </button></li>`).join("")}</ul>`
        : '<p class="case-empty">No ward meets all of these for your brief. Raise the rent ceiling or widen the area to see more.</p>'}
    </section>`;
}

function bar(label, value, max, colour, title, shown = String(value)) {
  return `<li class="bar-row" title="${escapeHtml(title)}"><span>${escapeHtml(label)}</span>
    <span class="bar-track"><span class="bar-fill" style="width:${(100 * value) / max}%; background:${colour}"></span></span>
    <span class="bar-value">${shown}</span></li>`;
}

function stacked(level, max) {
  return `<li class="bar-row" title="${escapeHtml(`${level.name}: ${level.mapped} well-mapped wards, ${level.thin} thin-data wards`)}">
    <span>${cap(level.name)}</span>
    <span class="bar-track">
      <span class="bar-fill" style="width:${(100 * level.mapped) / max}%; background:${INK}"></span>
      <span class="bar-fill thin" style="width:${(100 * level.thin) / max}%; background-color:var(--line-strong)"></span>
    </span>
    <span class="bar-value">${level.mapped + level.thin}</span></li>`;
}

function cap(text) {
  return text[0].toUpperCase() + text.slice(1);
}
