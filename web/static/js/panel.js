import { CATEGORIES, escapeHtml, num, otherCategory } from "./format.js";
import { LENSES, rationale } from "./score.js";

export const STEPS = ["Format", "Priority", "Shortlist"];

const VIEWS = { 1: chooseCategory, 2: chooseLens, 3: shortlist };

export function renderPanel(element, state, data) {
  element.innerHTML = progress(state.step) + VIEWS[state.step](state, data);
}

export function renderLoadError(element, detail) {
  element.innerHTML = `
    <div class="status" role="alert">
      <p class="status-title">Could not load map data — is the data container finished?</p>
      <p>Run <code>docker compose up</code>, wait for the data container to exit, then reload.</p>
      <p class="status-detail">${escapeHtml(detail)}</p>
    </div>`;
}

function progress(current) {
  const items = STEPS.map((label, i) => {
    const step = i + 1;
    if (step === current) return `<li class="current" aria-current="step">${label}</li>`;
    return `<li class="${step < current ? "done" : ""}">${label}</li>`;
  });
  return `<ol class="progress" aria-label="Step ${current} of ${STEPS.length}">${items.join("")}</ol>`;
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
  return `
    <h2 tabindex="-1">What are you opening?</h2>
    <p class="lede">Pick a format to see where that kind of place already is.</p>
    <div class="options" role="radiogroup" aria-label="Format">${rows.join("")}</div>
    ${hint}
    <button class="primary" data-action="next" ${category ? "" : "disabled"}>Continue</button>`;
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
  return `
    <button class="text-button back" data-action="back">Back</button>
    <h2 tabindex="-1">What matters most?</h2>
    <p class="lede">Each lens weighs footfall, competing ${c.many} and their ratings. They differ in how
      much each one counts.</p>
    <div class="options" role="radiogroup" aria-label="Priority">${rows.join("")}</div>
    <button class="primary" data-action="next" ${lens ? "" : "disabled"}>Show my shortlist</button>`;
}

function shortlist({ category, lens }, { meta, localities, ranking, averageRating }) {
  const c = CATEGORIES[category];
  const rows = ranking.slice(0, 5).map(({ feature, score }, i) => `
    <li><button class="pick" data-action="pick" data-value="${i}">
      <span class="pick-rank num">${i + 1}</span>
      <span class="pick-name">${escapeHtml(feature.properties.name)}</span>
      <span class="pick-score num">${score.toFixed(1)}</span>
      <span class="pick-why">${rationale(feature.properties, category, lens, averageRating)}</span>
    </button></li>`);
  const lensButtons = Object.entries(LENSES).map(([key, l]) =>
    `<button role="radio" aria-checked="${lens === key}" data-action="lens" data-value="${key}">${l.name}</button>`);
  const unscored = localities.length - ranking.length;
  return `
    <button class="text-button back" data-action="back">Back</button>
    <h2 tabindex="-1">Your shortlist</h2>
    <p class="lede">The five best localities for a new ${c.one}, ranked for ${LENSES[lens].name.toLowerCase()}.</p>
    <div class="lens-switch" role="radiogroup" aria-label="Rank by">${lensButtons.join("")}</div>
    <div class="picks-head"><span>Locality</span><span>Score</span></div>
    <ol class="picks">${rows.join("")}</ol>
    <p class="note">Scores compare the ${num(ranking.length)} localities with at least
      ${num(meta.min_pois_to_score)} cafes and QSRs between them. The other ${num(unscored)} have too few
      to score fairly.</p>
    <button class="text-button" data-action="restart">Start over</button>`;
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
