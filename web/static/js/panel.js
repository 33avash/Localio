import { EXAMPLES } from "./chat.js";
import { CATEGORIES, escapeHtml, num, rupees } from "./format.js";
import { AREAS, breakdown, competitionLevel, LENSES, monthlyRent } from "./score.js";

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

// ---- Plan: the inputs, then the top 5 they produce -------------------------

function plan(state, { wards, meta, rent, ranking }) {
  const { plan: p } = state;
  const few = wards.filter((f) => f.properties.status !== "scored").length;
  return {
    body: `
      <section class="plan" aria-label="Your plan">
        ${choice("Opening a", "category", p.category, Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, v.label])))}
        ${choice("Priority", "lens", p.lens, Object.fromEntries(Object.entries(LENSES).map(([k, v]) => [k, v.name])))}
        <p class="field-hint">${LENSES[p.lens].describe}</p>
        ${choice("Area", "area", p.area, AREAS)}
        <div class="field-pair">
          <label class="field"><span class="field-label">Shop size</span>
            <span class="input-unit"><input id="sqft" type="number" inputmode="numeric" min="50" max="5000" step="25"
              value="${p.sqft}"><span>sq ft</span></span></label>
          <label class="field"><span class="field-label">Rent budget a month</span>
            <span class="input-unit"><span>₹</span><input id="budget" type="number" inputmode="numeric" min="1000"
              step="1000" placeholder="any" value="${p.budget ?? ""}"></span></label>
        </div>
        <label class="check"><input id="include-low" type="checkbox" ${p.includeLow ? "checked" : ""}>
          <span>Include the ${num(few)} wards with under ${num(meta.min_outlets)} outlets mapped</span></label>
      </section>
      <section class="results" id="results" aria-labelledby="results-title">${results(state, { wards, meta, rent, ranking })}</section>`,
    foot: "",
  };
}

// Typing a size or budget redraws only this part, so the field being
// typed in keeps its focus and caret.
export function renderResults(body, state, data) {
  const section = body.querySelector("#results");
  if (section) section.innerHTML = results(state, data);
}

function results(state, { wards, meta, rent, ranking }) {
  const p = state.plan;
  return `
    <h2 id="results-title" tabindex="-1">Top 5 for a ${CATEGORIES[p.category].one}</h2>
    <p class="results-sub">${LENSES[p.lens].name} · ${AREAS[p.area]} · ${num(ranking.length)} wards fit</p>
    ${ranking.length ? picks(state, { meta, rent, ranking }) : empty(state, { wards, rent })}`;
}

// A row of buttons that behave as radio buttons, for one plan setting.
function choice(label, key, value, options) {
  const id = `label-${key}`;
  const buttons = Object.entries(options).map(([option, text]) =>
    `<button role="radio" aria-checked="${option === value}" data-action="set" data-key="${key}" data-value="${option}">${text}</button>`);
  return `
    <div class="field-row">
      <span class="field-label" id="${id}">${label}</span>
      <div class="segmented" role="radiogroup" aria-labelledby="${id}">${buttons.join("")}</div>
    </div>`;
}

// Each row splits its score into busyness and low-competition points, so
// the ranking explains itself.
function picks(state, { meta, rent, ranking }) {
  const { category, lens, sqft } = state.plan;
  const c = CATEGORIES[category];
  const rows = ranking.slice(0, 5).map(({ feature, score }, i) => {
    const p = feature.properties;
    const part = breakdown(p, category, lens);
    const level = competitionLevel(p, category, meta.city.per_10k[category]);
    return `
      <li><button class="pick" data-action="pick" data-value="${i}" data-name="${escapeHtml(p.name)}">
        <span class="pick-rank num">${i + 1}</span>
        <span class="pick-main">
          <span class="pick-name">${escapeHtml(p.name)}${p.status === "scored" ? "" : ' <span class="low-flag">few outlets</span>'}</span>
          <span class="split" aria-hidden="true"><span class="split-busy" style="width:${part.busy.toFixed(1)}%"></span><span
            class="split-room" style="width:${part.room.toFixed(1)}%"></span></span>
          <span class="pick-why">${num(Math.round(part.busy))} busy + ${num(Math.round(part.room))} room ·
            ${num(p.categories[category].count)} ${c.many}, ${level} competition · ${num(rupees(monthlyRent(rent, p, sqft)))} rent</span>
        </span>
        <span class="pick-score num" data-score="${score}">${Math.round(score)}</span>
      </button></li>`;
  });
  return `
    <ol class="picks">${rows.join("")}</ol>
    <p class="note"><span class="key key-busy"></span>Busyness and <span class="key key-room"></span>low competition add up
      to each score out of 100. Click a ward for the details.</p>`;
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

// ---- Ask: the chat, answering from the same data and the same plan ----------

// Ranked answers get numbers; reasons and comparisons get bullets.
function list({ kind, list: lines }) {
  const tag = ["ranking", "gap", "cheapest"].includes(kind) ? "ol" : "ul";
  return `<${tag} class="msg-list">${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</${tag}>`;
}

function ask(state, { conversation }) {
  const { messages, draft } = conversation;
  const p = state.plan;
  const items = messages.map((m, i) => (m.role === "user"
    ? `<li class="msg msg-user">${escapeHtml(m.text)}</li>`
    : `<li class="msg msg-answer${m.kind === "refuse" ? " msg-refused" : ""}">
        <p>${escapeHtml(m.text)}</p>
        ${m.list?.length ? list(m) : ""}
        ${m.wards?.length ? `<div class="chips">${m.wards.map((name) =>
          `<button class="chip" data-action="open-ward" data-value="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>` : ""}
        ${m.plan ? `<button class="secondary compact" data-action="apply" data-value="${i}">Use this plan on the map</button>` : ""}
      </li>`));
  const intro = messages.length ? "" : `
    <h2 tabindex="-1">Ask about any ward</h2>
    <p class="lede">Answers come only from Localio's data. Mention a format, area, budget or shop size and I'll use
      it.</p>
    <div class="suggestions">${EXAMPLES.map((q) =>
      `<button class="chip" data-action="ask" data-value="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("")}</div>`;
  return {
    body: `
      <p class="chat-context">Your plan: ${CATEGORIES[p.category].label} · ${LENSES[p.lens].name} · ${AREAS[p.area]} ·
        ${num(p.sqft)} sq ft${p.budget ? ` · rent up to ${num(rupees(p.budget))}` : ""}</p>
      ${intro}
      <ol class="messages" aria-live="polite" aria-label="Conversation">${items.join("")}</ol>`,
    foot: `
      <form class="ask-form" data-form="ask">
        <label class="visually-hidden" for="ask-input">Your question</label>
        <textarea id="ask-input" rows="2" maxlength="300" placeholder="e.g. Tell me about Baner">${escapeHtml(draft)}</textarea>
        <button class="primary" type="submit">Send</button>
      </form>`,
  };
}
