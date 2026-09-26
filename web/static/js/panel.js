import { CATEGORIES, escapeHtml, num, otherCategory } from "./format.js";
import { LENSES, rationale } from "./score.js";

export const STEPS = ["Format", "Priority", "Shortlist"];

const VIEWS = { 1: chooseCategory, 2: chooseLens, 3: shortlist };

// The panel has three fixed regions: the step rail in the header, one
// scrolling body, and a footer that keeps the step's main action in view.
export function renderPanel({ rail, body, foot }, state, data) {
  const view = VIEWS[state.step](state, data);
  rail.innerHTML = stepRail(state.step);
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

// Completed steps are buttons, so the rail doubles as the way back.
function stepRail(current) {
  const items = STEPS.map((label, i) => {
    const step = i + 1;
    if (step === current) return `<li><span class="rail-step current" aria-current="step">${label}</span></li>`;
    if (step < current) {
      return `<li><button class="rail-step done" data-action="goto" data-value="${step}">${label}</button></li>`;
    }
    return `<li><span class="rail-step upcoming">${label}</span></li>`;
  });
  return `<ol aria-label="Step ${current} of ${STEPS.length}">${items.join("")}</ol>`;
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
      <p class="lede">Each lens weighs footfall, competing ${c.many} and their ratings. They differ in how
        much each one counts.</p>
      <div class="options" role="radiogroup" aria-label="Priority">${rows.join("")}</div>`,
    foot: `<button class="primary" data-action="next" ${lens ? "" : "disabled"}>Show my shortlist</button>`,
  };
}

// Each row carries a bar behind it, scaled to the top score, so the list
// reads as a ranking rather than five unrelated numbers.
function shortlist({ category, lens, filters }, { meta, localities, ranking, averageRating, empty }) {
  const c = CATEGORIES[category];
  const top = ranking.slice(0, 5);
  const best = Math.max(0.01, ...top.map((r) => r.score));
  const rows = top.map(({ feature, score }, i) => `
    <li><button class="pick" data-action="pick" data-value="${i}" data-name="${escapeHtml(feature.properties.name)}">
      <span class="pick-bar" style="width:${barWidth(score, best)}%"></span>
      <span class="pick-rank num">${i + 1}</span>
      <span class="pick-name">${escapeHtml(feature.properties.name)}${feature.properties.status === "scored"
        ? "" : ' <span class="low-flag">low confidence</span>'}</span>
      <span class="pick-score num" data-score="${score}">${score.toFixed(1)}</span>
      <span class="pick-why">${rationale(feature.properties, category, lens,
        { averageRating, cityPer10k: meta.city.per_10k[category] })}</span>
    </button></li>`);
  const lensButtons = Object.entries(LENSES).map(([key, l]) =>
    `<button role="radio" aria-checked="${lens === key}" data-action="lens" data-value="${key}">${l.name}</button>`);
  const confident = localities.filter((f) => f.properties.status === "scored").length;
  const list = top.length
    ? `<div class="picks-head"><span>Locality</span><span>Score</span></div><ol class="picks">${rows.join("")}</ol>`
    : emptyState(empty);
  return {
    body: `
      <h2 tabindex="-1">Your shortlist</h2>
      <p class="lede">The five best localities for a new ${c.one}, ranked for ${LENSES[lens].name.toLowerCase()}.</p>
      <div class="lens-switch" role="radiogroup" aria-label="Rank by">${lensButtons.join("")}</div>
      ${filterControls(c, filters)}
      ${list}
      <p class="note">${num(confident)} localities have at least ${num(meta.min_pois_to_score)} cafes and QSRs
        between them. The other ${num(localities.length - confident)} are scored too, but hatched on the map and
        left off this list unless you include them, because so few outlets make their numbers shaky.</p>`,
    foot: `<button class="secondary" data-action="restart">Start over</button>`,
  };
}

export const MAX_OPTIONS = [null, 0, 1, 2, 3, 5];

function filterControls(c, { maxCompetitors, includeLow }) {
  const options = MAX_OPTIONS.map((value) => `<option value="${value ?? ""}" ${value === maxCompetitors ? "selected" : ""}>
    ${value === null ? "any number of" : value}</option>`);
  return `
    <div class="filters">
      <label class="filter">At most <select data-filter="max">${options.join("")}</select> ${c.many} already there</label>
      <label class="filter"><input type="checkbox" data-filter="low" ${includeLow ? "checked" : ""}>
        Include low-confidence areas</label>
    </div>`;
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
    ? `<span class="option-weights">Footfall ${percent(weights.demand)} · Competition ${percent(weights.supply)}
       · Ratings ${percent(weights.weakness)}</span>`
    : "";
  return `
    <button class="option" role="radio" aria-checked="${selected}" data-action="${action}" data-value="${value}">
      <span class="option-title">${title}</span>
      <span class="option-detail">${detail}</span>
      ${split}
    </button>`;
}

function percent(weight) {
  return num(`${Math.round(weight * 100)}%`);
}
