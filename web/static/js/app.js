import { drawerHtml } from "./drawer.js";
import { defaults } from "./economics.js";
import { CATEGORIES } from "./format.js";
import { createMap } from "./map.js";
import { methodHtml } from "./method.js";
import { animateScores } from "./motion.js";
import { ASSUMPTIONS, assumptionResults, MAX_OPTIONS, renderLoadError, renderPanel, STEPS } from "./panel.js";
import { LENSES, rank } from "./score.js";
import { enableSheet } from "./sheet.js";

const panel = document.getElementById("panel");
const drawer = document.getElementById("drawer");
const regions = {
  rail: document.getElementById("panel-rail"),
  body: document.getElementById("panel-body"),
  foot: document.getElementById("panel-foot"),
};

const sheet = enableSheet(panel, document.getElementById("sheet-handle"));

async function getJson(url) {
  const response = await fetch(url).catch(() => {
    throw new Error(`${url}: no response from the server`);
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

// The key is optional, so a missing config just means OpenStreetMap tiles.
const config = await getJson("config.json").catch(() => ({}));
const map = createMap(document.getElementById("map"), {
  cartoKey: config.cartoKey,
  onSelect: (name) => openLocality(name),
});

// A failed load says so in the panel, where people are looking, rather
// than leaving a blank map and an error in the console. The model report
// only feeds "How it works", so the app runs without it; every money
// figure needs economics.json.
async function loadData() {
  try {
    const [pois, localities, econ, report] = await Promise.all([
      getJson("data/pois.geojson"),
      getJson("data/localities.geojson"),
      getJson("data/economics.json"),
      getJson("data/model_report.json").catch(() => null),
    ]);
    if (!pois.features?.length || !localities.features?.length) throw new Error("The GeoJSON files are empty.");
    return { pois: pois.features, localities: localities.features, meta: localities.meta, econ, report };
  } catch (error) {
    renderLoadError(regions.body, error.message);
    return null;
  }
}

const data = await loadData();

// Assumptions carried in the URL hash, as ?param=value.
const HASH_KEYS = { size: "size", sqft: "sqft", rent: "rent_psf", setup: "setup", margin: "target_margin" };

const state = {
  ...(data ? readHash() : { step: 1, category: null, lens: null, assumptions: {} }),
  filters: { maxCompetitors: null, includeLow: false },
  conversation: { messages: [], pending: false, draft: "" },
};

// Assumptions are kept per format (a cafe's sq ft isn't a QSR's) and start
// from the sourced defaults in economics.json.
function inputs() {
  if (!state.category) return null;
  state.assumptions[state.category] ??= defaults(data.econ, state.category);
  return state.assumptions[state.category];
}
let shown = { ranking: [], lens: null, scores: new Map(), widths: new Map() };
let returnFocus = null;
// Matches the sheet's height transition in localio.css.
const SHEET_MS = 260;

const actions = {
  category: (value) => { state.category = value; },
  lens: (value) => { state.lens = value; },
  next: () => { state.step += 1; },
  goto: (value) => { state.step = Number(value); },
  relax: (value) => {
    if (value === "low") state.filters.includeLow = true;
    else state.filters.maxCompetitors = value === "" ? null : Number(value);
  },
  restart: () => {
    Object.assign(state, { step: 1, category: null, lens: null, filters: { maxCompetitors: null, includeLow: false } });
    closeDrawer();
    map.resetView();
  },
  // A new format size brings its own sourced size and setup cost; the rent
  // and margin someone typed carry over.
  size: (value) => {
    const { rent_psf, target_margin } = inputs();
    state.assumptions[state.category] = { ...defaults(data.econ, state.category, value), rent_psf, target_margin };
  },
  "reset-assumptions": () => { state.assumptions[state.category] = defaults(data.econ, state.category); },
};

// Controls that open or close the drawer don't change the flow, so they
// skip the re-render (which would rebuild the list under the user).
const drawerActions = {
  pick: (value) => openLocality(shown.ranking[Number(value)].feature.properties.name, { fly: true }),
  "open-locality": (value) => openLocality(value, { fly: true }),
  "close-drawer": () => closeDrawer(),
  method: () => openDrawer(methodHtml(data?.report, data?.econ)),
  ask: (value) => send(value),
};

panel.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const { action, value } = control.dataset;
  if (drawerActions[action]) {
    drawerActions[action](value);
    return;
  }
  const previousStep = state.step;
  if (control.hasAttribute("data-close-drawer")) closeDrawer();
  actions[action](value);
  render();
  restoreFocus(control, state.step !== previousStep);
});

// The chat input: Enter sends, Shift+Enter adds a line, and the draft
// survives re-renders.
panel.addEventListener("submit", (event) => {
  if (!event.target.matches("[data-form=ask]")) return;
  event.preventDefault();
  send(event.target.querySelector("textarea").value);
});

panel.addEventListener("keydown", (event) => {
  if (event.target.id !== "ask-input" || event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  event.target.form.requestSubmit();
});

panel.addEventListener("input", (event) => {
  if (event.target.id === "ask-input") state.conversation.draft = event.target.value;
  if (event.target.dataset.assume) assume(event.target);
});

// Typing in an assumption recomputes the figures under it straight away.
// Only the results re-render, so the field keeps focus and caret. A value
// that isn't a usable number is marked and ignored until it is.
const ASSUME = {
  sqft: (v) => ({ sqft: v }),
  rent_psf: (v) => ({ rent_psf: v }),
  setup_lakh: (v) => ({ setup: Math.round(v * 1e5) }),
  margin_pct: (v) => ({ target_margin: v / 100 }),
};

function assume(field) {
  const value = Number(field.value);
  const ok = field.value.trim() !== "" && Number.isFinite(value) && value >= Number(field.min)
    && value <= Number(field.max);
  field.setAttribute("aria-invalid", String(!ok));
  if (!ok) return;
  Object.assign(inputs(), ASSUME[field.dataset.assume](value));
  document.getElementById("assume-results").innerHTML = assumptionResults(viewState(), viewData());
  writeHash();
}

panel.addEventListener("change", (event) => {
  const filter = event.target.closest("[data-filter]");
  if (!filter) return;
  if (filter.dataset.filter === "max") state.filters.maxCompetitors = filter.value === "" ? null : Number(filter.value);
  else state.filters.includeLow = filter.checked;
  render();
  panel.querySelector(`[data-filter="${filter.dataset.filter}"]`)?.focus();
});

// The folded filters stay as the user left them across re-renders.
panel.addEventListener("toggle", (event) => {
  if (event.target.matches("details.filters")) state.filters.open = event.target.open;
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !drawer.hidden) closeDrawer();
});

// What the panel views read: the state with the current assumptions, and
// the data with the ranking. Assumptions reuses the shortlist's lens, or
// proven footfall if none is picked yet.
function viewState() {
  return { ...state, inputs: inputs() };
}

function viewData() {
  const ranked = state.category && state.step >= 3 && (state.lens || state.step === ASSUMPTIONS);
  const ranking = ranked ? shortlist(state.filters, state.lens ?? "footfall") : [];
  return {
    meta: data.meta,
    econ: data.econ,
    localities: data.localities,
    ranking,
    empty: state.step === 3 && !ranking.length ? emptyExplanation() : null,
    conversation: state.conversation,
  };
}

function render() {
  const view = viewData();
  const { ranking } = view;
  renderPanel(regions, viewState(), view);
  map.render({
    step: state.step,
    category: state.category,
    lens: state.lens,
    meta: data.meta,
    pois: data.pois,
    localities: data.localities,
    picks: ranking.slice(0, 5).map(({ feature }) => feature),
  });
  writeHash();
  wireRows(ranking);
}

// Hovering or focusing a row finds its marker; when the lens changed,
// scores count from their old values so the re-ranking is visible.
function wireRows(ranking) {
  const rows = [...regions.body.querySelectorAll("[data-action=pick]")];
  const animated = [];
  for (const row of rows) {
    const index = Number(row.dataset.value);
    for (const [type, on] of [["mouseenter", true], ["mouseleave", false], ["focus", true], ["blur", false]]) {
      row.addEventListener(type, () => map.highlightPick(index, on));
    }
    const { name } = row.dataset;
    const scoreElement = row.querySelector(".pick-score");
    const bar = row.querySelector(".pick-bar");
    const to = Number(scoreElement.dataset.score);
    if (shown.lens && shown.lens !== state.lens) {
      animated.push({
        element: scoreElement, bar, to, from: shown.scores.get(name) ?? to,
        toWidth: parseFloat(bar.style.width), fromWidth: shown.widths.get(name) ?? 0,
      });
    }
  }
  if (animated.length) animateScores(animated);
  shown = {
    ranking,
    lens: state.step === 3 ? state.lens : null,
    scores: new Map(rows.map((row) => [row.dataset.name, Number(row.querySelector(".pick-score").dataset.score)])),
    widths: new Map(rows.map((row) => [row.dataset.name, parseFloat(row.querySelector(".pick-bar").style.width)])),
  };
}

async function send(text) {
  const question = text.trim();
  const { conversation } = state;
  if (!question || conversation.pending) return;
  conversation.messages.push({ role: "user", text: question });
  conversation.pending = true;
  conversation.draft = "";
  renderChat();
  conversation.messages.push(await answer(question));
  conversation.pending = false;
  renderChat();
  document.getElementById("ask-input")?.focus();
}

async function answer(question) {
  try {
    const response = await fetch("api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, category: state.category, lens: state.lens }),
    });
    // 502-504 come from nginx when the api container isn't there.
    if (response.status >= 502) throw new Error(`HTTP ${response.status}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return { role: "answer", error: true, text: body.detail ?? `The chat service returned HTTP ${response.status}.` };
    return { role: "answer", text: body.answer, cited: body.cited, refused: body.refused, mode: body.mode };
  } catch {
    return { role: "answer", error: true, text: "The chat service isn't reachable. The map and shortlist still work." };
  }
}

// Re-render the Ask step and keep the newest message in view.
function renderChat() {
  if (state.step !== 4) return;
  render();
  regions.body.scrollTop = regions.body.scrollHeight;
}

function shortlist({ maxCompetitors, includeLow }, lens = state.lens) {
  const all = rank(data.localities, state.category, lens, { includeLow });
  if (maxCompetitors === null) return all;
  return all.filter(({ feature }) => feature.properties.categories[state.category].count <= maxCompetitors);
}

// Name the filter that emptied the list, and offer the smallest change
// that brings localities back.
function emptyExplanation() {
  const { maxCompetitors, includeLow } = state.filters;
  const { many } = CATEGORIES[state.category];
  if (maxCompetitors === null) return { message: "No locality matches.", relax: null };
  const scope = includeLow ? "locality" : "confident locality";
  const looser = MAX_OPTIONS.filter((value) => value === null || value > maxCompetitors)
    .find((value) => shortlist({ maxCompetitors: value, includeLow }).length > 0);
  const message = `No ${scope} has ${maxCompetitors === 0 ? "zero" : `${maxCompetitors} or fewer`} ${many} already
    open, so the "at most ${maxCompetitors}" filter rules them all out.`;
  if (looser !== undefined) {
    return { message, relax: { value: looser ?? "", label: looser === null ? `Allow any number of ${many}` : `Allow up to ${looser}` } };
  }
  return { message, relax: includeLow ? null : { value: "low", label: "Include low-confidence areas" } };
}

function openLocality(name, { fly = false } = {}) {
  const feature = data.localities.find((f) => f.properties.name === name);
  if (!feature) return;
  const sheetMoved = openDrawer(drawerHtml(feature, {
    category: state.category,
    lens: state.lens,
    meta: data.meta,
    econ: data.econ,
    inputs: inputs(),
    rank: rankOf(feature),
  }));
  map.select(name);
  if (!fly) return;
  // On a phone the sheet just rose; fly once the map has its new size.
  if (sheetMoved) setTimeout(() => map.focusLocality(name), SHEET_MS);
  else map.focusLocality(name);
}

function rankOf(feature) {
  if (!state.category || !state.lens || feature.properties.status !== "scored") return null;
  const confident = rank(data.localities, state.category, state.lens);
  return { position: confident.findIndex((r) => r.feature === feature) + 1, of: confident.length };
}

// The drawer slides over the panel, never the map: the map is the context.
function openDrawer(html) {
  if (drawer.hidden) returnFocus = document.activeElement;
  drawer.innerHTML = html;
  drawer.hidden = false;
  requestAnimationFrame(() => drawer.classList.add("open"));
  drawer.querySelector("#drawer-title").focus();
  return sheet.expand();
}

function closeDrawer() {
  if (drawer.hidden) return;
  drawer.classList.remove("open");
  drawer.hidden = true;
  map.select(null);
  const usable = returnFocus?.isConnected && returnFocus !== document.body;
  const target = usable ? returnFocus : regions.body.querySelector("h2");
  target?.focus();
  returnFocus = null;
}

// Re-rendering replaces the panel's buttons, so put keyboard focus back:
// on the new heading after a step change, otherwise on the same control.
function restoreFocus(control, stepChanged) {
  const { action, value } = control.dataset;
  const selector = stepChanged ? "h2" : `[data-action="${action}"]${value ? `[data-value="${value}"]` : ""}`;
  (regions.body.querySelector(selector) ?? panel.querySelector(selector))?.focus();
}

// The URL hash mirrors the flow and any changed assumption
// (#shortlist/qsr/footfall?sqft=450&rent=160), so a shortlist can be
// reloaded or shared exactly as it looked.
function readHash() {
  const [path, query = ""] = decodeURIComponent(location.hash.slice(1)).split("?");
  const [stepName, slug, lens] = path.split("/");
  const category = Object.keys(CATEGORIES).find((key) => CATEGORIES[key].slug === slug) ?? null;
  const knownLens = Object.hasOwn(LENSES, lens ?? "") ? lens : null;
  let step = Math.max(1, STEPS.findIndex((name) => name.toLowerCase() === stepName) + 1);
  if (step !== ASSUMPTIONS && !category) step = 1;
  else if (step >= 3 && step !== ASSUMPTIONS && !knownLens) step = 2;
  return { step, category, lens: knownLens, assumptions: category ? { [category]: readAssumptions(category, query) } : {} };
}

function readAssumptions(category, query) {
  const params = new URLSearchParams(query);
  const sizes = data.econ.sizes[category];
  const values = defaults(data.econ, category, sizes.includes(params.get("size")) ? params.get("size") : sizes[0]);
  for (const [param, key] of Object.entries(HASH_KEYS)) {
    const value = Number(params.get(param));
    if (param !== "size" && params.has(param) && Number.isFinite(value) && value > 0) values[key] = value;
  }
  return values;
}

// Only what differs from the defaults goes in the hash.
function writeHash() {
  const parts = [STEPS[state.step - 1].toLowerCase(), CATEGORIES[state.category]?.slug, state.lens];
  let hash = state.category || state.step === ASSUMPTIONS ? `#${parts.filter(Boolean).join("/")}` : "";
  if (state.category) {
    const current = inputs();
    const base = defaults(data.econ, state.category, current.size);
    const changed = Object.entries(HASH_KEYS).filter(([param, key]) => (param === "size"
      ? current.size !== data.econ.sizes[state.category][0] : current[key] !== base[key]));
    if (changed.length) hash += `?${changed.map(([param, key]) => `${param}=${current[key]}`).join("&")}`;
  }
  history.replaceState(null, "", hash || location.pathname);
}

if (data) {
  map.fitData(data.localities);
  render();
}
