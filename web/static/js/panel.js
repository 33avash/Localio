import { CATEGORIES, escapeHtml, num, otherCategory, rupees } from "./format.js";
import { competitionLevel, LENSES, monthlyRent } from "./score.js";

export const STEPS = ["Format", "Priority", "Shortlist", "Ask"];

// Drawn from api/tests/ask_cases.jsonl, so every example is one the tests
// know gets a good answer.
export const EXAMPLES = [
  "Where should I open a QSR?",
  "Which areas have no cafes yet?",
  "Tell me about Koregaon Park",
];

const VIEWS = { 1: chooseCategory, 2: chooseLens, 3: shortlist, 4: chat };

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
      <p class="status-title">Couldn't load the map data.</p>
      <p>Run <code>docker compose up</code>, wait for the data container to finish, then reload.</p>
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
    ? `<p class="note">Grey dots are ${CATEGORIES[otherCategory(category)].many} and restaurants: not direct
       competitors, but they show where people already eat out.</p>`
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
      <p class="lede">Every ward is scored on two things: how busy it is, and how many ${c.many} are already
        there for its residents. Choose how much each counts.</p>
      <div class="options" role="radiogroup" aria-label="Priority">${rows.join("")}</div>`,
    foot: `<button class="primary" data-action="next" ${lens ? "" : "disabled"}>Show my shortlist</button>`,
  };
}

// Five rows, each with a bar scaled to the top score so the list reads as
// a ranking, and the ward's monthly rent for the shop size typed above.
function shortlist(state, { meta, wards, rent, ranking }) {
  const { category, sqft, includeLow } = state;
  const c = CATEGORIES[category];
  const top = ranking.slice(0, 5);
  const best = Math.max(0.01, ...top.map((r) => r.score));
  const rows = top.map(({ feature, score }, i) => {
    const p = feature.properties;
    const level = competitionLevel(p, category, meta.city.per_10k[category]);
    return `
    <li><button class="pick" data-action="pick" data-value="${i}" data-name="${escapeHtml(p.name)}">
      <span class="pick-bar" style="width:${Math.max(0, (score / best) * 100).toFixed(1)}%"></span>
      <span class="pick-rank num">${i + 1}</span>
      <span class="pick-name">${escapeHtml(p.name)}${p.status === "scored" ? "" : ' <span class="low-flag">few outlets</span>'}</span>
      <span class="pick-rent num" data-rent-for="${p.key}">${rupees(monthlyRent(rent, p, sqft))}</span>
      <span class="pick-why">Score <span class="pick-score num" data-score="${score}">${score.toFixed(0)}</span> ·
        ${num(p.categories[category].count)} ${c.many} here, ${level === "none" ? "no" : level} competition</span>
    </button></li>`;
  });
  const lensButtons = Object.entries(LENSES).map(([key, l]) =>
    `<button role="radio" aria-checked="${state.lens === key}" data-action="lens" data-value="${key}">${l.name}</button>`);
  const few = wards.filter((f) => f.properties.status !== "scored").length;
  return {
    body: `
      <h2 tabindex="-1">Your shortlist</h2>
      <p class="lede">The five best wards for a new ${c.one}. Scores are out of 100.</p>
      <div class="lens-switch" role="radiogroup" aria-label="Rank by">${lensButtons.join("")}</div>
      <div class="controls">
        <label class="size-field">Shop size
          <input id="sqft" type="number" inputmode="numeric" min="50" max="5000" step="25" value="${sqft}"> sq ft</label>
        <label class="filter"><input id="include-low" type="checkbox" ${includeLow ? "checked" : ""}>
          Include the ${num(few)} wards with under ${num(meta.min_outlets)} outlets</label>
      </div>
      <div class="picks-head"><span>Ward</span><span>Rent a month</span></div>
      <ol class="picks">${rows.join("")}</ol>
      <p class="note">Rent is typical Pune shop rent, scaled by each ward's rent tier. Click a ward for the details.</p>`,
    foot: `
      <div class="foot-actions">
        <button class="secondary" data-action="restart">Start over</button>
        <button class="primary" data-action="next">Ask about these</button>
      </div>`,
  };
}

// Typing a shop size updates just the rent cells, not the whole panel.
export function rentCells(body, state, data) {
  for (const cell of body.querySelectorAll("[data-rent-for]")) {
    const ward = data.wards.find((f) => f.properties.key === cell.dataset.rentFor);
    cell.textContent = rupees(monthlyRent(data.rent, ward.properties, state.sqft));
  }
}

// Ask: questions answered from the same ward facts as the map. Your
// messages sit right in a bubble; answers are plain text, with the wards
// they rely on as chips that open the drawer.
function chat({ conversation }, { wards }) {
  const { messages, pending, draft } = conversation;
  const items = messages.map((m) => (m.role === "user"
    ? `<li class="msg msg-user">${escapeHtml(m.text)}</li>`
    : `<li class="msg msg-answer${m.refused ? " msg-refused" : ""}${m.error ? " msg-error" : ""}">
        <p>${escapeHtml(m.text)}</p>
        ${m.cited?.length ? `<div class="chips">${m.cited.map((name) =>
          `<button class="chip" data-action="open-ward" data-value="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>` : ""}
        ${m.mode === "offline" ? '<p class="msg-note">Answered from templates, without a language model.</p>' : ""}
      </li>`));
  const examples = messages.length ? "" : `
    <p class="lede">Ask about any of Pune's ${num(wards.length)} wards, or where a format fits best. Answers use
      only Localio's data.</p>
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

function option({ action, value, selected, title, detail, weights }) {
  const split = weights
    ? `<span class="option-weights">Busyness ${pct(weights.demand)} · Competition ${pct(weights.competition)}</span>`
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
