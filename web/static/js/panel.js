import { EXAMPLES } from "./chat.js";
import { CATEGORIES, escapeHtml, num, rupees } from "./format.js";
import { confidence, fitBand } from "./insight.js";
import { AREAS, briefOf, COMPETITION, competitionLevel, COMPONENTS, CUSTOMERS, monthlyRent, parts, roundedParts } from "./score.js";

// The panel has one scrolling body and an optional footer that keeps the
// analyst's input in view. The tabs in the header switch between them.
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

// ---- Plan: the site brief, then the shortlist it produces -----------------

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
      ${state.intro ? intro(data) : ""}
      <section class="brief" aria-label="Site brief">
        <div class="brief-head"><p class="eyebrow">Site brief</p>
          <button class="text-button" data-action="reset">Reset</button></div>
        ${step("01", "What are you opening?", options("category", p.category,
          Object.fromEntries(Object.entries(CATEGORIES).map(([key, c]) => [key, { label: c.label, hint: FORMATS[key] }])), "formats", "Format"))}
        ${step("02", "Who are you serving?", options("customers", customers, CUSTOMERS, "customers", "Customers"))}
        ${step("03", "Competition tolerance", segmented("competition", competition,
          Object.fromEntries(Object.entries(COMPETITION).map(([key, c]) => [key, c.label])), "Competition"))}
        ${step("04", "Market constraints", `
          ${segmented("area", p.area, AREAS, "Area")}
          <div class="field-pair">
            <label class="field"><span class="field-label">Shop size</span>
              <span class="input-unit"><input id="sqft" type="number" inputmode="numeric" min="50" max="5000" step="25"
                value="${p.sqft}"><span>sq ft</span></span></label>
            <label class="field"><span class="field-label">Rent ceiling a month</span>
              <span class="input-unit"><span>₹</span><input id="budget" type="number" inputmode="numeric" min="1000"
                step="1000" placeholder="no limit" value="${p.budget ?? ""}"></span></label>
          </div>`)}
        <details class="fine-tune" id="fine-tune" ${state.fineTune ? "open" : ""}>
          <summary>Adjust the model</summary>
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

// What the product is for, until it's dismissed.
function intro({ wards }) {
  return `
    <section class="intro" aria-labelledby="intro-title">
      <h2 id="intro-title" class="intro-title">Evaluate your next market</h2>
      <p>Tell Localio what you're opening, who you're serving and what you can spend. It ranks all
        ${num(wards.length)} wards in Pune on the people around and the competition already there, estimates the rent,
        and says how far to trust each number.</p>
      <button class="secondary compact" data-action="dismiss-intro">Got it</button>
    </section>`;
}

function step(n, title, control) {
  return `
    <fieldset class="step">
      <legend class="step-title"><span class="step-n" aria-hidden="true">${n}</span>${title}</legend>
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
      yourself; the share is that part's weight in the score.</p>
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

function results(state, data) {
  const { wards, ranking } = data;
  const p = state.plan;
  return `
    <div class="results-head">
      <h2 id="results-title" tabindex="-1">Location shortlist</h2>
    </div>
    <p class="results-sub">For ${briefSentence(p)}. ${num(ranking.length)} of ${num(wards.length)} wards fit.</p>
    ${state.change ? changesHtml(state.change, state.baseline) : state.baseline ? pinnedHtml() : ""}
    ${ranking.length ? picks(state, data) : empty(state, data)}`;
}

// What the last change of brief did to the list, or what the brief has
// done since the pinned baseline.
function changesHtml(change, baseline) {
  const items = [];
  if (change.count.before !== change.count.after) {
    items.push(`<li>${num(change.count.before)} → ${num(change.count.after)} wards fit</li>`);
  }
  if (change.entered.length) items.push(`<li><span class="delta-in">+${change.entered.length}</span> into the top 5: ${change.entered.map(escapeHtml).join(", ")}</li>`);
  if (change.exited.length) items.push(`<li><span class="delta-out">−${change.exited.length}</span> out of the top 5: ${change.exited.map(escapeHtml).join(", ")}</li>`);
  if (change.mover) {
    const from = change.mover.from ? `#${change.mover.from}` : "outside the list";
    items.push(`<li>Biggest mover: <strong>${escapeHtml(change.mover.name)}</strong> ${num(from)} → ${num(`#${change.mover.to}`)}. ${escapeHtml(change.mover.reason)}</li>`);
  }
  if (!items.length) items.push("<li>The top 5 held.</li>");
  return `
    <section class="changes" aria-live="polite" aria-label="Shortlist change">
      <div class="changes-head">
        <p class="eyebrow">${baseline ? "Since your baseline" : "Shortlist change"}</p>
        ${baseline ? '<button class="text-button" data-action="baseline" data-value="clear">Clear baseline</button>'
          : '<button class="text-button" data-action="baseline" data-value="pin">Pin this as baseline</button>'}
      </div>
      <p class="changes-said">${change.said.length ? change.said.map(escapeHtml).join(" · ") : "Same brief"}</p>
      <ul class="changes-list">${items.join("")}</ul>
    </section>`;
}

// A pinned baseline the brief hasn't moved from yet.
function pinnedHtml() {
  return `
    <section class="changes" aria-live="polite" aria-label="Shortlist change">
      <div class="changes-head">
        <p class="eyebrow">Baseline pinned</p>
        <button class="text-button" data-action="baseline" data-value="clear">Clear baseline</button>
      </div>
      <p class="changes-said">Change the brief to see how the shortlist moves against this one.</p>
    </section>`;
}

// A bar of the score's four parts, each as wide as its points.
export function partsBar(items) {
  return `<span class="bar4" aria-hidden="true">${items.map((item) =>
    `<span style="width:${item.points.toFixed(1)}%; background:${item.colour}"></span>`).join("")}</span>`;
}

// Every row states its fit, how far to trust it, and all four parts of its
// score, so the ranking explains itself; the rent is for the brief's size.
function picks(state, { rent, ranking, meta }) {
  const { category, weights, sqft } = state.plan;
  const rows = ranking.slice(0, 5).map(({ feature, score }, i) => {
    const p = feature.properties;
    const { items } = parts(p, category, weights);
    const points = roundedParts(items);
    const conf = confidence(p, meta);
    return `
      <li><button class="pick" data-action="pick" data-value="${i}" data-name="${escapeHtml(p.name)}">
        <span class="pick-rank">${i + 1}</span>
        <span class="pick-main">
          <span class="pick-head"><span class="pick-name">${escapeHtml(p.name)}</span>
            <span class="pick-rent num">${rupees(monthlyRent(rent, p, sqft))}/mo</span></span>
          <span class="pick-meta"><span class="fit-tag">${fitBand(score).label}</span>
            <span class="conf conf-${conf.level.toLowerCase()}" title="${escapeHtml(conf.summary)}">${conf.level} confidence</span>
            ${p.status === "scored" ? "" : '<span class="low-flag">thin data</span>'}</span>
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
      <button class="secondary compact" data-action="share-dialog">Share analysis</button>
      <button class="secondary compact" data-action="export-csv">Export CSV</button>
    </div>
    <p class="note">Scores are out of 100: the four parts added up. Click a ward for the full analysis.</p>`;
}

// Says what emptied the list, and offers the smallest changes that fix it.
function empty(state, { wards, rent }) {
  const p = state.plan;
  const open = wards.filter(({ properties: w }) => (p.includeLow || w.status === "scored")
    && (p.area === "all" || w.corporation.toLowerCase() === p.area));
  const fixes = [];
  let reason = `No ward in ${AREAS[p.area]} has enough outlets mapped to be confident.`;
  if (p.budget && open.length) {
    const cheapest = Math.min(...open.map(({ properties: w }) => monthlyRent(rent, w, p.sqft)));
    const raise = Math.ceil(cheapest / 1000) * 1000;
    reason = `No ward's rent fits ${num(rupees(p.budget))} a month for ${num(p.sqft)} sq ft. The cheapest here is ${num(rupees(cheapest))}.`;
    fixes.push(`<button class="secondary" data-action="set" data-key="budget" data-value="${raise}">Raise the ceiling to ${rupees(raise)}</button>`);
    const lowest = Math.min(...open.map(({ properties: w }) => w.rent.multiplier));
    const fits = Math.floor(p.budget / (rent.typical_psf * lowest) / 25) * 25;
    // Only a size a shop could still work in: at least 100 sq ft and half the brief's.
    if (fits >= Math.max(100, p.sqft / 2) && fits < p.sqft) fixes.push(`<button class="secondary" data-action="set" data-key="sqft" data-value="${fits}">Look at ${fits} sq ft instead</button>`);
  }
  if (p.area !== "all") fixes.push('<button class="secondary" data-action="area" data-value="all">Search all of Pune</button>');
  if (!p.includeLow) fixes.push('<button class="secondary" data-action="set" data-key="includeLow" data-value="true">Include thin-data wards</button>');
  return `
    <div class="empty" role="status">
      <p class="empty-title">No locations match your brief.</p>
      <p>${reason}</p>
      <div class="empty-actions">${fixes.join("")}</div>
    </div>`;
}

// The limits, where the decision is made rather than in a drawer.
function limits() {
  return `
    <section class="limits" aria-labelledby="limits-title">
      <h3 id="limits-title" class="eyebrow">Decision caveats</h3>
      <ul>
        <li><strong>Visit first.</strong> The score compares wards from data. It can't see the street, the shop or
          the footfall at your hours.</li>
        <li><strong>Outlets are undercounted.</strong> They come from OpenStreetMap, which misses places, most of all
          in Pimpri-Chinchwad. "No cafes" can mean "none mapped".</li>
        <li><strong>Residents are 2011 figures.</strong> Newer areas at the city's edge have grown since.</li>
        <li><strong>Rent is an estimate</strong> from published rents, not a quote.</li>
        <li><strong>No sales forecast.</strong> Localio says where to look, not what a shop will earn.</li>
      </ul>
      <button class="text-button" data-action="method">How the score, confidence and rent are worked out</button>
    </section>`;
}

// ---- Analyst: answers from the same data and the same brief --------------

// Ranked answers get numbers; reasons and comparisons get bullets.
function list({ kind, list: lines }) {
  const tag = ["ranking", "gap", "cheapest"].includes(kind) ? "ol" : "ul";
  return `<${tag} class="msg-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</${tag}>`;
}

// The figures behind an answer, computed here from the ward data, never
// taken from the language model's wording.
function evidence(names, { wards, rent, meta }, plan) {
  const fmt = CATEGORIES[plan.category];
  const reference = meta.score.reference_per_10k[plan.category];
  const blocks = names.map((name) => wards.find((f) => f.properties.name === name)?.properties).filter(Boolean).map((p) => {
    const { items, total } = parts(p, plan.category, plan.weights);
    const points = roundedParts(items);
    const conf = confidence(p, meta);
    const c = p.categories[plan.category];
    return `
      <table class="data-table">
        <thead><tr><th scope="col" colspan="2" style="text-align:left">${escapeHtml(p.name)}</th></tr></thead>
        <tbody>
          <tr><th scope="row">Score</th><td class="num">${Math.round(total)} = ${points.join(" + ")}</td></tr>
          <tr><th scope="row">Rent, ${plan.sqft} sq ft</th><td class="num">${rupees(monthlyRent(rent, p, plan.sqft))}/mo</td></tr>
          <tr><th scope="row">Residents</th><td class="num">${p.population.toLocaleString("en-US")}</td></tr>
          <tr><th scope="row">${fmt.label}s mapped</th><td class="num">${c.count} (${c.per_10k.toFixed(2)}/10k; ${competitionLevel(p, plan.category, reference)})</td></tr>
          <tr><th scope="row">Offices · colleges · stations</th><td class="num">${p.draws.offices} · ${p.draws.colleges} · ${p.draws.stations}</td></tr>
          <tr><th scope="row">Confidence</th><td>${conf.level}</td></tr>
        </tbody>
      </table>`;
  });
  if (!blocks.length) return "";
  const osm = meta.sources?.find((s) => s.id === "outlets");
  return `
    <details class="evidence">
      <summary>Show evidence</summary>
      <div class="evidence-body">
        ${blocks.join("")}
        <p class="evidence-sources">Computed by Localio from the ward data. Sources: OpenStreetMap${osm ? ` (retrieved ${escapeHtml(osm.retrieved_at)})` : ""};
          Census 2011; Cushman &amp; Wakefield Q2 2026 and Square Yards listings for rent.</p>
      </div>
    </details>`;
}

function ask(state, data) {
  const { messages, draft, pending } = data.conversation;
  const items = messages.map((m, i) => (m.role === "user"
    ? `<li class="msg msg-user">${escapeHtml(m.text)}</li>`
    : `<li class="msg msg-answer${m.kind === "refuse" ? " msg-refused" : ""}">
        <p>${escapeHtml(m.text)}</p>
        ${m.list?.length ? list(m) : ""}
        ${m.wards?.length ? `<div class="chips">${m.wards.map((name) =>
          `<button class="chip" data-action="open-ward" data-value="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>` : ""}
        ${m.plan ? `<button class="secondary compact" data-action="apply" data-value="${i}">Use this on the map</button>` : ""}
        ${m.wards?.length ? evidence(m.wards, data, m.brief ?? state.plan) : ""}
      </li>`));
  const intro = messages.length ? "" : `
    <p class="eyebrow">Localio Analyst</p>
    <h2 tabindex="-1">Ask about any ward</h2>
    <p class="lede">Ask in your own words: where to open, why a ward ranks where it does, how two compare, what rent
      to expect. Every figure comes from Localio's ward data and your brief, with the evidence one click away. If the
      data can't answer, it says so.</p>
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
        <textarea id="ask-input" rows="2" maxlength="300" placeholder="e.g. Which wards have low competition but strong daytime draw?"
          ${pending ? "disabled" : ""}>${escapeHtml(draft)}</textarea>
        <button class="primary" type="submit" ${pending ? "disabled" : ""}>Send</button>
      </form>`,
  };
}
