import { EXAMPLES } from "./chat.js";
import { CATEGORIES, escapeHtml, num, rupees } from "./format.js";
import { AREAS, briefOf, COMPETITION, COMPONENTS, CUSTOMERS, monthlyRent, parts, roundedParts } from "./score.js";

// The panel has one scrolling body and an optional footer that keeps the
// chat's input in view. The tabs in the header switch between them.
export function renderPanel({ body, foot, tabs }, state, data) {
  const view = state.tab === "ask" ? ask(state, data) : plan(state, data);
  for (const tab of tabs) {
    const on = tab.dataset.value === state.tab;
    tab.setAttribute("aria-selected", String(on));
    tab.tabIndex = on ? 0 : -1;
  }
  body.setAttribute("aria-labelledby", `tab-${state.tab}`);
  body.innerHTML = view.body;
  foot.innerHTML = view.foot;
  foot.hidden = !view.foot;
}

export function renderLoadError(element, detail) {
  element.innerHTML = `
    <div class="status" role="alert">
      <p class="status-title">Couldn't load the ward data.</p>
      <p>Reload the page. Running it yourself? Start it with <code>docker compose up</code> and wait for the data
        container to finish.</p>
      <p class="status-detail">${escapeHtml(detail)}</p>
    </div>`;
}

// "a 300 sq ft cafe for office workers and students, avoiding competition,
// in Pune city, rent up to ₹35k": the plan as one sentence.
export function briefSentence(p) {
  const { customers, competition } = briefOf(p.weights);
  const who = customers && competition
    ? `for ${CUSTOMERS[customers].label.toLowerCase()}, ${COMPETITION[competition].phrase}`
    : "with your own weights";
  return `a ${num(p.sqft)} sq ft ${CATEGORIES[p.category].one} ${who}, in ${AREAS[p.area] === "All of Pune" ? "all of Pune" : AREAS[p.area]}`
    + `${p.budget ? `, rent up to ${num(rupees(p.budget))}` : ""}`;
}

// ---- Plan: the brief, then the shortlist it produces -----------------------

const FORMATS = {
  cafe: "coffee, chai, bakery",
  fast_food: "burgers, pizza, rolls",
};

function plan(state, data) {
  const { plan: p } = state;
  const { customers, competition } = briefOf(p.weights);
  const few = data.wards.filter((f) => f.properties.status !== "scored").length;
  return {
    body: `
      ${state.intro ? intro() : ""}
      <section class="brief" aria-label="Your brief">
        ${step(1, "What are you opening?", options("category", p.category,
          Object.fromEntries(Object.entries(CATEGORIES).map(([key, c]) => [key, { label: c.label, hint: FORMATS[key] }])), "formats", "Format"))}
        ${step(2, "Who are your customers?", options("customers", customers, CUSTOMERS, "customers", "Customers"))}
        ${step(3, "How much competition can you take?", segmented("competition", competition,
          Object.fromEntries(Object.entries(COMPETITION).map(([key, c]) => [key, c.label])), "Competition"))}
        ${step(4, "Where, and how big?", `
          ${segmented("area", p.area, AREAS, "Area")}
          <div class="field-pair">
            <label class="field"><span class="field-label">Shop size</span>
              <span class="input-unit"><input id="sqft" type="number" inputmode="numeric" min="50" max="5000" step="25"
                value="${p.sqft}"><span>sq ft</span></span></label>
            <label class="field"><span class="field-label">Rent you can pay a month</span>
              <span class="input-unit"><span>₹</span><input id="budget" type="number" inputmode="numeric" min="1000"
                step="1000" placeholder="any" value="${p.budget ?? ""}"></span></label>
          </div>`)}
        <details class="fine-tune" id="fine-tune" ${state.fineTune ? "open" : ""}>
          <summary>Fine-tune the score</summary>
          ${weightsControl(p.weights)}
          <label class="check"><input id="include-low" type="checkbox" ${p.includeLow ? "checked" : ""}>
            <span>Include the ${num(few)} wards with under ${num(data.meta.min_outlets)} outlets mapped (thin data)</span></label>
        </details>
      </section>
      <section class="results" id="results" aria-labelledby="results-title">${results(state, data)}</section>
      ${limits()}`,
    foot: "",
  };
}

// What the site is for, until it's dismissed.
function intro() {
  return `
    <section class="intro" aria-labelledby="intro-title">
      <h2 id="intro-title" class="intro-title">Find where to look first</h2>
      <p>Planning a cafe or a QSR in Pune? Answer four questions. Localio ranks all 140 wards on the people around and
        the competition already there, and estimates the rent, so you know which areas to visit first.</p>
      <p class="intro-small">It can't predict sales, and its data has gaps: see "Before you decide" below the list.</p>
      <button class="secondary compact" data-action="dismiss-intro">Got it</button>
    </section>`;
}

function step(n, title, control) {
  return `
    <fieldset class="step">
      <legend class="step-title"><span class="step-n num" aria-hidden="true">${n}</span>${title}</legend>
      ${control}
    </fieldset>`;
}

// Radio buttons as cards, each with a line of detail.
function options(action, value, choices, name, label) {
  const buttons = Object.entries(choices).map(([key, c]) => `
    <button role="radio" aria-checked="${key === value}" data-action="${action}" data-value="${key}"
      aria-label="${escapeHtml(c.label)}" aria-describedby="hint-${key}">
      <span class="option-label">${c.label}</span><span class="option-hint" id="hint-${key}">${c.hint}</span>
    </button>`);
  return `<div class="options options-${name}" role="radiogroup" aria-label="${label}">${buttons.join("")}</div>`;
}

// A row of buttons that behave as radio buttons.
function segmented(action, value, choices, label) {
  const buttons = Object.entries(choices).map(([key, label]) =>
    `<button role="radio" aria-checked="${key === value}" data-action="${action}" data-value="${key}">${label}</button>`);
  return `<div class="segmented" role="radiogroup" aria-label="${label}">${buttons.join("")}</div>`;
}

// The four weights as sliders, for anyone who wants more than the brief.
function weightsControl(weights) {
  const sum = COMPONENTS.reduce((total, c) => total + weights[c.key], 0);
  const sliders = COMPONENTS.map((c) => `
    <label class="weight">
      <span class="weight-name"><span class="key" style="background:${c.colour}"></span>${c.label}</span>
      <input type="range" min="0" max="5" step="1" value="${weights[c.key]}" data-weight="${c.key}"
        aria-describedby="about-${c.key}">
      <output class="weight-share num" data-share="${c.key}">${share(weights[c.key], sum)}</output>
      <span class="visually-hidden" id="about-${c.key}">${c.about}</span>
    </label>`);
  return `
    <p class="fine-tune-note">Your answers set how much each part of the score counts. Move a slider to set it
      yourself.</p>
    <div class="weight-list">${sliders.join("")}</div>`;
}

function share(weight, sum) {
  return `${Math.round(sum ? (100 * weight) / sum : 25)}%`;
}

// Moving a slider updates the shares and the brief's answers in place, so
// the slider being dragged keeps its focus.
export function updateWeights(body, weights) {
  const sum = COMPONENTS.reduce((total, c) => total + weights[c.key], 0);
  for (const output of body.querySelectorAll("[data-share]")) output.textContent = share(weights[output.dataset.share], sum);
  const brief = briefOf(weights);
  for (const action of ["customers", "competition"]) {
    for (const button of body.querySelectorAll(`[data-action=${action}]`)) {
      button.setAttribute("aria-checked", String(button.dataset.value === brief[action]));
    }
  }
}

// Typing a size or budget, or moving a slider, redraws only this part.
export function renderResults(body, state, data) {
  const section = body.querySelector("#results");
  if (section) section.innerHTML = results(state, data);
}

function results(state, { wards, rent, ranking }) {
  const p = state.plan;
  return `
    <h2 id="results-title" tabindex="-1">Your shortlist</h2>
    <p class="results-sub">For ${briefSentence(p)}. ${num(ranking.length)} of ${num(wards.length)} wards fit.</p>
    ${ranking.length ? picks(state, { rent, ranking }) : empty(state, { wards, rent })}`;
}

// A bar of the score's four parts, each as wide as its points.
export function partsBar(items) {
  return `<span class="bar4" aria-hidden="true">${items.map((item) =>
    `<span style="width:${item.points.toFixed(1)}%; background:${item.colour}"></span>`).join("")}</span>`;
}

// Every row states all four parts of its score, so the ranking explains
// itself; the rent is for the shop size in the brief.
function picks(state, { rent, ranking }) {
  const { category, weights, sqft } = state.plan;
  const rows = ranking.slice(0, 5).map(({ feature, score }, i) => {
    const p = feature.properties;
    const { items } = parts(p, category, weights);
    const points = roundedParts(items);
    return `
      <li><button class="pick" data-action="pick" data-value="${i}" data-name="${escapeHtml(p.name)}">
        <span class="pick-rank num">${i + 1}</span>
        <span class="pick-main">
          <span class="pick-head"><span class="pick-name">${escapeHtml(p.name)}${p.status === "scored" ? ""
            : ' <span class="low-flag">thin data</span>'}</span>
            <span class="pick-rent num">${rupees(monthlyRent(rent, p, sqft))}/mo</span></span>
          ${partsBar(items)}
          <span class="pick-parts">${items.map((item, j) =>
            `<span><span class="num" data-part="${item.key}">${points[j]}</span> ${item.label.toLowerCase()}</span>`).join("")}</span>
        </span>
        <span class="pick-score num" data-score="${score}">${Math.round(score)}</span>
      </button></li>`;
  });
  return `
    <ol class="picks">${rows.join("")}</ol>
    <div class="result-actions">
      ${ranking.length >= 2 ? '<button class="secondary compact" data-action="compare">Compare the top 3</button>' : ""}
      <button class="secondary compact" data-action="share">Copy link to this shortlist</button>
      <span class="share-status" role="status" id="share-status"></span>
    </div>
    <p class="note">Scores are out of 100: the four parts added up. Click a ward for its details.</p>`;
}

// Says what emptied the list, and offers the smallest change that fixes it.
function empty(state, { wards, rent }) {
  const p = state.plan;
  const open = wards.filter(({ properties: w }) => (p.includeLow || w.status === "scored")
    && (p.area === "all" || w.corporation.toLowerCase() === p.area));
  if (p.budget && open.length) {
    const cheapest = Math.min(...open.map(({ properties: w }) => monthlyRent(rent, w, p.sqft)));
    return `
      <div class="empty" role="status">
        <p>No ward's rent fits ${num(rupees(p.budget))} a month for ${num(p.sqft)} sq ft. The cheapest here is
          ${num(rupees(cheapest))}.</p>
        <button class="secondary" data-action="set" data-key="budget" data-value="${Math.ceil(cheapest / 1000) * 1000}">
          Raise the budget to ${rupees(Math.ceil(cheapest / 1000) * 1000)}</button>
      </div>`;
  }
  return `
    <div class="empty" role="status">
      <p>No ward in ${AREAS[p.area]} has enough outlets mapped to be confident.</p>
      <button class="secondary" data-action="set" data-key="includeLow" data-value="true">Include them anyway</button>
    </div>`;
}

// The limits, where the decision is made rather than in a drawer.
function limits() {
  return `
    <section class="limits" aria-labelledby="limits-title">
      <h3 id="limits-title">Before you decide</h3>
      <ul>
        <li><strong>Visit first.</strong> The score compares wards from data. It can't see the street, the shop or
          the footfall at your hours.</li>
        <li><strong>Outlets are undercounted.</strong> They come from OpenStreetMap, which misses places, most of all
          in Pimpri-Chinchwad. "No cafes" can mean "none mapped".</li>
        <li><strong>Residents are 2011 figures.</strong> Newer areas at the city's edge have grown since.</li>
        <li><strong>Rent is an estimate</strong> from published rents, not a quote.</li>
        <li><strong>No sales forecast.</strong> Localio says where to look, not what a shop will earn.</li>
      </ul>
      <button class="text-button" data-action="method">How the score and rent are worked out</button>
    </section>`;
}

// ---- Ask: the chat, answering from the same data and the same brief ---------

// Ranked answers get numbers; reasons and comparisons get bullets.
function list({ kind, list: lines }) {
  const tag = ["ranking", "gap", "cheapest"].includes(kind) ? "ol" : "ul";
  return `<${tag} class="msg-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</${tag}>`;
}

function ask(state, { conversation }) {
  const { messages, draft, pending } = conversation;
  const items = messages.map((m, i) => (m.role === "user"
    ? `<li class="msg msg-user">${escapeHtml(m.text)}</li>`
    : `<li class="msg msg-answer${m.kind === "refuse" ? " msg-refused" : ""}">
        <p>${escapeHtml(m.text)}</p>
        ${m.list?.length ? list(m) : ""}
        ${m.wards?.length ? `<div class="chips">${m.wards.map((name) =>
          `<button class="chip" data-action="open-ward" data-value="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>` : ""}
        ${m.plan ? `<button class="secondary compact" data-action="apply" data-value="${i}">Use this on the map</button>` : ""}
      </li>`));
  const intro = messages.length ? "" : `
    <h2 tabindex="-1">Ask about any ward</h2>
    <p class="lede">Ask in your own words: where to open, why a ward ranks where it does, what rent to expect. Answers
      come from Localio's ward data and your brief. Click a ward in an answer to check its numbers.</p>
    <div class="suggestions">${EXAMPLES.map((q) =>
      `<button class="chip" data-action="ask" data-value="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("")}</div>`;
  return {
    body: `
      <p class="chat-context">Your brief: ${briefSentence(state.plan)}</p>
      ${intro}
      <ol class="messages" aria-live="polite" aria-label="Conversation">${items.join("")}
        ${pending ? '<li class="msg msg-answer typing" aria-label="Writing an answer"><span></span><span></span><span></span></li>' : ""}
      </ol>`,
    foot: `
      <form class="ask-form" data-form="ask">
        <label class="visually-hidden" for="ask-input">Your question</label>
        <textarea id="ask-input" rows="2" maxlength="300" placeholder="e.g. Best spot near colleges under ₹35k rent?"
          ${pending ? "disabled" : ""}>${escapeHtml(draft)}</textarea>
        <button class="primary" type="submit" ${pending ? "disabled" : ""}>Send</button>
      </form>`,
  };
}
