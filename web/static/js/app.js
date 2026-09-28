import { drawerHtml } from "./drawer.js";
import { CATEGORIES } from "./format.js";
import { createMap } from "./map.js";
import { methodHtml } from "./method.js";
import { animateScores } from "./motion.js";
import { renderLoadError, renderPanel, rentCells, STEPS } from "./panel.js";
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
  onSelect: (name) => openWard(name),
});

// A failed load says so in the panel, where people are looking, rather
// than leaving a blank map and an error in the console.
async function loadData() {
  try {
    const [pois, wards, rent] = await Promise.all(
      ["data/pois.geojson", "data/wards.geojson", "data/rent.json"].map(getJson),
    );
    if (!pois.features?.length || !wards.features?.length) throw new Error("The GeoJSON files are empty.");
    return { pois: pois.features, wards: wards.features, meta: wards.meta, rent };
  } catch (error) {
    renderLoadError(regions.body, error.message);
    return null;
  }
}

const data = await loadData();

const state = {
  ...(data ? readHash() : { step: 1, category: null, lens: null, sqft: 300 }),
  includeLow: false,
  conversation: { messages: [], pending: false, draft: "" },
};
let shown = { ranking: [], lens: null, scores: new Map(), widths: new Map() };
let returnFocus = null;
// Matches the sheet's height transition in localio.css.
const SHEET_MS = 260;

const actions = {
  category: (value) => { state.category = value; },
  lens: (value) => { state.lens = value; },
  next: () => { state.step += 1; },
  goto: (value) => { state.step = Number(value); },
  restart: () => {
    Object.assign(state, { step: 1, category: null, lens: null });
    closeDrawer();
    map.resetView();
  },
};

// Controls that open the drawer or send a question don't change the flow,
// so they skip the re-render (which would rebuild the list under the user).
const drawerActions = {
  pick: (value) => openWard(shown.ranking[Number(value)].feature.properties.name, { fly: true }),
  "open-ward": (value) => openWard(value, { fly: true }),
  "close-drawer": () => closeDrawer(),
  method: () => openDrawer(methodHtml(data)),
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

// Typing an outlet size updates every rent figure at once. Only the rent
// cells change, so the field keeps its focus and caret; a size that isn't
// a sensible number is marked and ignored until it is.
panel.addEventListener("input", (event) => {
  if (event.target.id === "ask-input") state.conversation.draft = event.target.value;
  if (event.target.id !== "sqft") return;
  const value = Number(event.target.value);
  const ok = Number.isFinite(value) && value >= 50 && value <= 5000;
  event.target.setAttribute("aria-invalid", String(!ok));
  if (!ok) return;
  state.sqft = value;
  rentCells(regions.body, state, data);
  writeHash();
});

panel.addEventListener("change", (event) => {
  if (event.target.id !== "include-low") return;
  state.includeLow = event.target.checked;
  render();
  document.getElementById("include-low")?.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !drawer.hidden) closeDrawer();
});

function ranking() {
  if (state.step < 3 || !state.category || !state.lens) return [];
  return rank(data.wards, state.category, state.lens, { includeLow: state.includeLow });
}

function render() {
  const ranked = ranking();
  renderPanel(regions, state, { ...data, ranking: ranked });
  map.render({
    step: state.step,
    category: state.category,
    meta: data.meta,
    pois: data.pois,
    wards: data.wards,
    picks: ranked.slice(0, 5).map(({ feature }) => feature),
  });
  writeHash();
  wireRows(ranked);
}

// Hovering or focusing a row finds its marker; when the priority changed,
// scores count from their old values so the re-ranking is visible.
function wireRows(ranked) {
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
    ranking: ranked,
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

function openWard(name, { fly = false } = {}) {
  const feature = data.wards.find((f) => f.properties.name === name);
  if (!feature) return;
  const sheetMoved = openDrawer(drawerHtml(feature, { ...state, meta: data.meta, rent: data.rent, rank: rankOf(feature) }));
  map.select(name);
  if (!fly) return;
  // On a phone the sheet just rose; fly once the map has its new size.
  if (sheetMoved) setTimeout(() => map.focusWard(name), SHEET_MS);
  else map.focusWard(name);
}

function rankOf(feature) {
  if (!state.category || !state.lens || feature.properties.status !== "scored") return null;
  const confident = rank(data.wards, state.category, state.lens);
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

// The URL hash mirrors the flow, e.g. #shortlist/qsr/busy?sqft=450, so a
// shortlist can be reloaded or shared exactly as it looked.
function readHash() {
  const [path, query = ""] = decodeURIComponent(location.hash.slice(1)).split("?");
  const [stepName, slug, lens] = path.split("/");
  const category = Object.keys(CATEGORIES).find((key) => CATEGORIES[key].slug === slug) ?? null;
  const knownLens = Object.hasOwn(LENSES, lens ?? "") ? lens : null;
  let step = Math.max(1, STEPS.findIndex((name) => name.toLowerCase() === stepName) + 1);
  if (!category) step = 1;
  else if (step >= 3 && !knownLens) step = 2;
  const sqft = Number(new URLSearchParams(query).get("sqft"));
  return { step, category, lens: knownLens, sqft: sqft >= 50 && sqft <= 5000 ? sqft : data.rent.default_sqft };
}

function writeHash() {
  const parts = [STEPS[state.step - 1].toLowerCase(), CATEGORIES[state.category]?.slug, state.lens];
  const size = state.sqft !== data.rent.default_sqft ? `?sqft=${state.sqft}` : "";
  const hash = state.category ? `#${parts.filter(Boolean).join("/")}${size}` : "";
  history.replaceState(null, "", hash || location.pathname);
}

if (data) {
  map.fitData(data.wards);
  render();
}
