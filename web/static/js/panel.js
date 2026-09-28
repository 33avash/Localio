import { insight, insightEntry, projectLocality } from "./economics.js";
import {
  capitalise, CATEGORIES, escapeHtml, num, otherCategory, percent, rupeeRange, rupees, SIZE_LABELS,
} from "./format.js";
import { competition, LENSES } from "./score.js";

export const STEPS = ["Format", "Priority", "Shortlist", "Ask", "Assumptions"];
export const ASSUMPTIONS = 5;

// Drawn from api/tests/ask_cases.jsonl, so every example is one the tests
// know gets a good answer.
export const EXAMPLES = [
  "Where should I open a QSR?",
  "Which areas have no cafes yet?",
  "Tell me about Koregaon Park",
];

const VIEWS = { 1: chooseCategory, 2: chooseLens, 3: shortlist, 4: chat, 5: assumptions };

// The panel has three fixed regions: the step rail in the header, one
// scrolling body, and a footer that keeps the step's main action in view.
export function renderPanel({ rail, body, foot }, state, data) {
  const view = VIEWS[state.step](state, data);
  rail.innerHTML = stepRail(state);
  body.innerHTML = view.body;
  foot.innerHTML = view.foot;
  foot.hidden = !view.foot;
}

export function renderLoadError(element, detail) {
  element.innerHTML = `
    <div class="status" role="alert">
      <p class="status-title">Could not load map data — is the data container finished?</p>
      <p>Run <code>docker compose up</code>, wait for the data container to exit, then reload.</p>
      <p class="status-detail">${escapeHtml(detail)}</p>
    </div>`;
}

// Steps that can already be shown are buttons, so the rail doubles as the
// way back. Assumptions sits apart at the end and is always reachable.
function stepRail({ step: current, category, lens }) {
  const reachable = (step) => step === ASSUMPTIONS || step === 1 || (step === 2 && category)
    || (step <= current && category && lens);
  const items = STEPS.map((label, i) => {
    const step = i + 1;
    const aside = step === ASSUMPTIONS ? ' class="rail-aside"' : "";
    if (step === current) return `<li${aside}><span class="rail-step current" aria-current="step">${label}</span></li>`;
    if (reachable(step)) {
      return `<li${aside}><button class="rail-step done" data-action="goto" data-value="${step}">${label}</button></li>`;
    }
    return `<li${aside}><span class="rail-step upcoming">${label}</span></li>`;
  });
  return `<ol aria-label="Steps">${items.join("")}</ol>`;
}

function chooseCategory({ category }, { meta }) {
  const rows = Object.entries(CATEGORIES).map(([key, c]) => option({
    action: "category",
    value: key,
    selected: category === key,
    title: c.label,
    detail: `${num(meta.category_counts[key])} in Pune${c.note ? ` · ${c.note}` : ""}`,
  }));
  const hint = category
    ? `<p class="note">Grey dots are ${CATEGORIES[otherCategory(category)].many}. They aren't direct competitors,
       but they show where people already go to eat.</p>`
    : "";
  return {
    body: `
      <h2 tabindex="-1">What are you opening?</h2>
      <p class="lede">Pick a format to see where that kind of place already is.</p>
      <div class="options" role="radiogroup" aria-label="Format">${rows.join("")}</div>
      ${hint}`,
    foot: `<button class="primary" data-action="next" ${category ? "" : "disabled"}>Continue</button>`,
  };
}

function chooseLens({ category, lens }) {
  const c = CATEGORIES[category];
  const rows = Object.entries(LENSES).map(([key, l]) => option({
    action: "lens",
    value: key,
    selected: lens === key,
    title: l.name,
    detail: l.describe(c),
    weights: l.weights,
  }));
  return {
    body: `
      <h2 tabindex="-1">What matters most?</h2>
      <p class="lede">Each lens weighs the same three things: how much trade the surroundings support, how
        many ${c.many} are already there per resident, and how far short of wards like it a ward falls.</p>
      <div class="options" role="radiogroup" aria-label="Priority">${rows.join("")}</div>`,
    foot: `<button class="primary" data-action="next" ${lens ? "" : "disabled"}>Show my shortlist</button>`,
  };
}

// The top five, each with its projected monthly profit, under the current
// assumptions. Shared by the shortlist and the Assumptions tab.
export function money(ranking, { category, inputs }, { econ, meta }) {
  return ranking.slice(0, 5).map(({ feature, score }) => ({
    feature,
    score,
    projection: projectLocality(econ, category, inputs, feature.properties, meta.city.per_10k[category]),
  }));
}

export function insightHtml(top, flag) {
  const text = insight(top.map(({ feature, projection }) => insightEntry(feature.properties, projection)), flag);
  if (!text) return "";
  return `<div class="insight" role="status"><p class="insight-label">What the money says</p><p>${escapeHtml(text)}</p></div>`;
}

// Each row carries a bar behind it, scaled to the top score, so the list
// reads as a ranking; the figure on the right is projected monthly profit.
function shortlist(state, data) {
  const { category, lens, filters, inputs } = state;
  const { meta, localities, ranking, empty } = data;
  const c = CATEGORIES[category];
  const top = money(ranking, state, data);
  const best = Math.max(0.01, ...top.map((r) => r.score));
  const rows = top.map(({ feature, score, projection }, i) => `
    <li><button class="pick" data-action="pick" data-value="${i}" data-name="${escapeHtml(feature.properties.name)}">
      <span class="pick-bar" style="width:${barWidth(score, best)}%"></span>
      <span class="pick-rank num">${i + 1}</span>
      <span class="pick-name">${escapeHtml(feature.properties.name)}${feature.properties.status === "scored"
        ? "" : ' <span class="low-flag">low confidence</span>'}</span>
      <span class="pick-money">${rupeeRange(projection.profit[0], projection.profit[2])}</span>
      <span class="pick-why">Score <span class="pick-score num" data-score="${score}">${score.toFixed(1)}</span> ·
        ${num(feature.properties.categories[category].count)} ${c.many} here,
        ${competition(feature.properties, category, meta.city.per_10k[category])} competition</span>
    </button></li>`);
  const lensButtons = Object.entries(LENSES).map(([key, l]) =>
    `<button role="radio" aria-checked="${lens === key}" data-action="lens" data-value="${key}">${l.name}</button>`);
  const confident = localities.filter((f) => f.properties.status === "scored").length;
  const list = top.length
    ? `${insightHtml(top, data.econ.rent.flag)}
       <div class="picks-head"><span>Ward</span><span>Profit a month, p10–p90</span></div>
       <ol class="picks">${rows.join("")}</ol>`
    : emptyState(empty);
  return {
    body: `
      <h2 tabindex="-1">Your shortlist</h2>
      <p class="lede">Top five wards for a ${SIZE_LABELS[category][inputs.size]} of ${num(inputs.sqft)} sq ft
        (<button class="text-button" data-action="goto" data-value="${ASSUMPTIONS}">change</button>).</p>
      <div class="lens-switch" role="radiogroup" aria-label="Rank by">${lensButtons.join("")}</div>
      ${filterControls(c, filters)}
      ${list}
      <p class="note">${num(confident)} wards have at least ${num(meta.min_pois_to_score)} food and drink outlets.
        The other ${num(localities.length - confident)} are scored too, but hatched on the map and left off this
        list unless you include them, because so few outlets make their numbers shaky.</p>`,
    foot: `
      <div class="foot-actions">
        <button class="secondary" data-action="restart">Start over</button>
        <button class="primary" data-action="next">Ask about these</button>
      </div>`,
  };
}

// Ask: questions answered from the same ward facts as the map. Your
// messages sit right in a bubble; answers are plain text, with the wards
// they rely on as chips that open the drawer.
function chat(_, { conversation, localities }) {
  const { messages, pending, draft } = conversation;
  const items = messages.map((m) => (m.role === "user"
    ? `<li class="msg msg-user">${escapeHtml(m.text)}</li>`
    : `<li class="msg msg-answer${m.refused ? " msg-refused" : ""}${m.error ? " msg-error" : ""}">
        <p>${escapeHtml(m.text)}</p>
        ${m.cited?.length ? `<div class="chips">${m.cited.map((name) =>
          `<button class="chip" data-action="open-locality" data-value="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>` : ""}
        ${m.mode === "offline" ? '<p class="msg-note">Answered from templates, without a language model.</p>' : ""}
      </li>`));
  const examples = messages.length ? "" : `
    <p class="lede">Ask about any of the ${num(localities.length)} wards, or where a format fits best. Answers only use
      Localio's data, including its projections at the default assumptions.</p>
    <div class="examples">${EXAMPLES.map((q) =>
      `<button class="example" data-action="ask" data-value="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("")}</div>`;
  return {
    body: `
      <h2 tabindex="-1">Ask</h2>
      ${examples}
      <ol class="messages" aria-live="polite" aria-label="Conversation">${items.join("")}
        ${pending ? '<li class="msg msg-answer typing" aria-label="Writing an answer"><span></span><span></span><span></span></li>' : ""}
      </ol>`,
    foot: `
      <form class="ask-form" data-form="ask">
        <label class="visually-hidden" for="ask-input">Your question</label>
        <textarea id="ask-input" rows="2" maxlength="300" placeholder="Ask about a ward or a format"
          ${pending ? "disabled" : ""}>${escapeHtml(draft)}</textarea>
        <button class="primary" type="submit" ${pending ? "disabled" : ""}>Send</button>
      </form>`,
  };
}

// Assumptions: the inputs behind every money figure, each naming its
// source, with the shortlist recomputed underneath as they change.
function assumptions(state, data) {
  const { category, inputs } = state;
  if (!category) {
    const rows = Object.entries(CATEGORIES).map(([key, c]) => option({
      action: "category", value: key, selected: false, title: c.label,
      detail: `Projections for a new ${c.one}`,
    }));
    return {
      body: `
        <h2 tabindex="-1">Assumptions</h2>
        <p class="lede">Money figures depend on the format. Pick one to see and edit its assumptions.</p>
        <div class="options" role="radiogroup" aria-label="Format">${rows.join("")}</div>`,
      foot: "",
    };
  }
  const { econ } = data;
  const fmt = econ.formats[`${econ.prefix[category]}_${inputs.size}`];
  const src = (key) => econ.sources[key];
  const sizes = econ.sizes[category].map((size) =>
    `<button role="radio" aria-checked="${inputs.size === size}" data-action="size" data-value="${size}">
      ${capitalise(SIZE_LABELS[category][size])}</button>`);
  const prefix = econ.prefix[category];
  return {
    body: `
      <h2 tabindex="-1">Assumptions</h2>
      <p class="lede">Change a number and every projection updates. Defaults are midpoints of published figures;
        hover a source for the full citation.</p>
      <div class="field">
        <span class="field-label" id="size-label">Format</span>
        <div class="segmented" role="radiogroup" aria-labelledby="size-label">${sizes.join("")}</div>
        ${sourceLine(src(`revenue_${prefix}_${inputs.size}`), `Revenue ${rupees(fmt.revenue[0])}–${rupees(fmt.revenue[1])} a month`)}
      </div>
      ${field("sqft", "Outlet size", "sq ft", inputs.sqft, { min: 50, max: 5000, step: 25 },
        src(`sqft_${prefix}_${inputs.size}`), `Published ${fmt.sqft[0]}–${fmt.sqft[1]} sq ft`)}
      ${field("rent_psf", "Baseline rent", "₹ per sq ft a month", inputs.rent_psf, { min: 10, max: 2000, step: 1 },
        src("rent_baseline_psf"), `Listings ₹${econ.rent.baseline[0]}–${econ.rent.baseline[1]}; each ward's tier scales it`)}
      ${field("setup_lakh", "Setup budget", "₹ lakh", +(inputs.setup / 1e5).toFixed(2), { min: 1, max: 500, step: 0.5 },
        src(`setup_${prefix}_${inputs.size}`), `Published ${rupees(fmt.setup[0])}–${rupees(fmt.setup[1])}`)}
      ${field("margin_pct", "Target net margin", "%", +(inputs.target_margin * 100).toFixed(1), { min: 0, max: 60, step: 0.5 },
        src("net_margin"), `Published ${percent(econ.sources.net_margin.low)}–${percent(econ.sources.net_margin.high)}`)}
      <button class="secondary compact" data-action="reset-assumptions">Reset to sourced defaults</button>
      <section class="assume-results" id="assume-results" aria-live="polite">${assumptionResults(state, data)}</section>`,
    foot: state.lens
      ? `<button class="primary" data-action="goto" data-value="3">Back to the shortlist</button>`
      : `<button class="primary" data-action="goto" data-value="2">Choose a priority</button>`,
  };
}

// The part of the Assumptions tab that recomputes on every keystroke,
// without re-rendering (and so losing) the field being typed in.
export function assumptionResults(state, data) {
  const { category, inputs } = state;
  const lens = state.lens ?? "footfall";
  const top = money(data.ranking, state, data);
  const fixed = data.econ.formats[`${data.econ.prefix[category]}_${inputs.size}`].fixed;
  const rows = top.map(({ feature, projection: p }, i) => {
    const payback = p.payback ? `${num(Math.round(p.payback[1]))} months to pay back` : escapeHtml(p.payback_note);
    const margin = p.margin[1];
    const meets = margin >= inputs.target_margin;
    return `
      <li>
        <span class="pick-rank num">${i + 1}</span>
        <span class="assume-name">${escapeHtml(feature.properties.name)}</span>
        <span class="assume-profit">${rupeeRange(p.profit[0], p.profit[2])}</span>
        <span class="assume-detail">${payback} · p50 margin
          <span class="num ${meets ? "pos" : "neg"}">${percent(margin)}</span> ${meets ? "meets" : "misses"} your
          ${percent(inputs.target_margin, 1)} target · rent ${num(rupees(p.rent))} a month</span>
      </li>`;
  });
  return `
    <h3>Your shortlist under these assumptions</h3>
    <p class="note tight">Top five for ${LENSES[lens].name.toLowerCase()}; profit a month, p10–p90.</p>
    ${insightHtml(top, data.econ.rent.flag)}
    <ol class="assume-list">${rows.join("")}</ol>
    <p class="note">Fixed costs of ${num(rupees(fixed))} a month (utilities, marketing, upkeep, delivery
      commissions) have no published figure: they are set so a mid-tier ward at the default size and rent earns the
      midpoint of the published net margin. Projections are directional, not investment advice.</p>`;
}

function field(key, label, unit, value, { min, max, step }, source, detail) {
  return `
    <label class="field">
      <span class="field-label">${label}</span>
      <span class="field-input"><input type="number" inputmode="decimal" data-assume="${key}" value="${value}"
        min="${min}" max="${max}" step="${step}"><span class="field-unit">${unit}</span></span>
      ${sourceLine(source, detail)}
    </label>`;
}

// A short source on the page; hovering it gives the full citation.
function sourceLine(source, detail) {
  const cited = source.basis === "published" ? escapeHtml(source.source.split(":")[0]) : escapeHtml(source.basis);
  const title = `${source.source}${source.url ? ` — ${source.url}` : ""} (retrieved ${source.retrieved}). ${source.note}`;
  return `<span class="field-source" title="${escapeHtml(title)}">${escapeHtml(detail)} · ${cited}</span>`;
}

export const MAX_OPTIONS = [null, 0, 1, 2, 3, 5];

// Folded away until wanted, and open whenever a filter is in use.
function filterControls(c, { maxCompetitors, includeLow, open }) {
  const options = MAX_OPTIONS.map((value) => `<option value="${value ?? ""}" ${value === maxCompetitors ? "selected" : ""}>
    ${value === null ? "any number of" : value}</option>`);
  const active = maxCompetitors !== null || includeLow;
  return `
    <details class="filters" ${active || open ? "open" : ""}>
      <summary>Filters${active ? " (on)" : ""}</summary>
      <label class="filter">At most <select data-filter="max">${options.join("")}</select> ${c.many} already there</label>
      <label class="filter"><input type="checkbox" data-filter="low" ${includeLow ? "checked" : ""}>
        Include low-confidence areas</label>
    </details>`;
}

// Says which filter emptied the list and offers the smallest change that
// brings results back.
function emptyState({ message, relax }) {
  const button = relax
    ? `<button class="secondary" data-action="relax" data-value="${relax.value}">${relax.label}</button>`
    : "";
  return `<div class="empty" role="status"><p>${message}</p>${button}</div>`;
}

function barWidth(score, best) {
  return Math.max(0, (score / best) * 100).toFixed(1);
}

function option({ action, value, selected, title, detail, weights }) {
  const split = weights
    ? `<span class="option-weights">Demand ${pct(weights.demand)} · Competition ${pct(weights.supply)}
       · Unmet demand ${pct(weights.gap)}</span>`
    : "";
  return `
    <button class="option" role="radio" aria-checked="${selected}" data-action="${action}" data-value="${value}">
      <span class="option-title">${title}</span>
      <span class="option-detail">${detail}</span>
      ${split}
    </button>`;
}

function pct(weight) {
  return num(`${Math.round(weight * 100)}%`);
}
