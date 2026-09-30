import { reply, wardIndex } from "./chat.js";
import { compareHtml, SLOTS } from "./compare.js";
import { askGemini } from "./llm.js";
import { drawerHtml } from "./drawer.js";
import { CATEGORIES } from "./format.js";
import { createMap } from "./map.js";
import { methodHtml } from "./method.js";
import { countUp } from "./motion.js";
import { renderLoadError, renderPanel, renderResults, updateWeights } from "./panel.js";
import {
  AREAS, briefOf, COMPETITION, COMPONENTS, CUSTOMERS, DEFAULT_BRIEF, leftOut, monthlyRent, parts, rank, weightsFor,
} from "./score.js";
import { enableSheet } from "./sheet.js";

const panel = document.getElementById("panel");
const drawer = document.getElementById("drawer");
const regions = {
  body: document.getElementById("panel-body"),
  foot: document.getElementById("panel-foot"),
  tabs: [...document.querySelectorAll("[role=tab]")],
};

const sheet = enableSheet(panel, document.getElementById("sheet-handle"));

async function getJson(url) {
  const response = await fetch(url).catch(() => {
    throw new Error(`${url}: no response from the server`);
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

// Both keys are optional: without a CARTO key the map uses OpenStreetMap
// tiles, and without a Gemini key the chat gives its own rule-based answers.
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
    if (!pois.features?.length || !wards.features?.length) throw new Error("The ward data is empty.");
    return { pois: pois.features, wards: wards.features, meta: wards.meta, rent, index: wardIndex(wards.features) };
  } catch (error) {
    renderLoadError(regions.body, error.message);
    return null;
  }
}

const data = await loadData();

const INTRO_KEY = "localio.intro";

const state = {
  tab: "plan",
  plan: data ? readHash() : null,
  // The intro explains what the site is for until it's dismissed once.
  intro: stored(INTRO_KEY) !== "seen",
  fineTune: false,
  compare: [],
  conversation: { messages: [], draft: "", last: [], pending: false, ai: Boolean(config.geminiKey) },
};
let shown = new Map();
let returnFocus = null;
// Matches the sheet's height transition in localio.css.
const SHEET_MS = 260;

// Setting a plan value from a button, the chat or the empty state.
const PARSE = {
  category: String, area: String,
  budget: (v) => (v === "" || v === null ? null : Number(v)),
  sqft: Number,
  includeLow: (v) => v === true || v === "true",
};

// The brief's answers: who the customers are sets three weights, how much
// competition sets the fourth.
const actions = {
  set: (control) => { state.plan[control.dataset.key] = PARSE[control.dataset.key](control.dataset.value); },
  category: (control) => { state.plan.category = control.dataset.value; },
  area: (control) => { state.plan.area = control.dataset.value; },
  customers: (control) => { state.plan.weights = { ...state.plan.weights, ...CUSTOMERS[control.dataset.value].weights }; },
  competition: (control) => { state.plan.weights = { ...state.plan.weights, room: COMPETITION[control.dataset.value].room }; },
  tab: (control) => { state.tab = control.dataset.value; },
  "dismiss-intro": () => {
    state.intro = false;
    store(INTRO_KEY, "seen");
  },
  apply: (control) => {
    Object.assign(state.plan, state.conversation.messages[Number(control.dataset.value)].plan);
    state.tab = "plan";
  },
};

// Controls that open the drawer or ask a question don't re-render the plan.
const quiet = {
  pick: (control) => openWard(ranking()[Number(control.dataset.value)].feature.properties.name, { fly: true }),
  "open-ward": (control) => openWard(control.dataset.value, { fly: true }),
  "close-drawer": () => closeDrawer(),
  method: () => openDrawer(methodHtml(data)),
  compare: () => openCompare(ranking().slice(0, SLOTS).map(({ feature }) => feature.properties.name)),
  // This ward first, then the best of the shortlist that isn't it.
  "compare-with": (control) => {
    const others = ranking().map(({ feature }) => feature.properties.name).filter((name) => name !== control.dataset.value);
    openCompare([control.dataset.value, ...others].slice(0, SLOTS));
  },
  share: () => share(),
  ask: (control) => send(control.dataset.value),
  "ask-ward": (control) => {
    closeDrawer();
    state.tab = "ask";
    send(`Tell me about ${control.dataset.value}`);
  },
};

panel.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (!control || !data) return;
  const { action } = control.dataset;
  if (quiet[action]) {
    quiet[action](control);
    return;
  }
  actions[action](control);
  render();
  const selector = `[data-action="${action}"][data-value="${control.dataset.value}"]${control.dataset.key ? `[data-key="${control.dataset.key}"]` : ""}`;
  (panel.querySelector(selector) ?? regions.body.querySelector("h2"))?.focus();
});

// Arrow keys move between tabs, as the ARIA tabs pattern expects.
panel.addEventListener("keydown", (event) => {
  if (event.target.matches("[role=tab]") && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
    state.tab = state.tab === "plan" ? "ask" : "plan";
    render();
    document.getElementById(`tab-${state.tab}`).focus();
    return;
  }
  if (event.target.id === "ask-input" && event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    event.target.form.requestSubmit();
  }
});

panel.addEventListener("submit", (event) => {
  if (!event.target.matches("[data-form=ask]")) return;
  event.preventDefault();
  send(event.target.querySelector("textarea").value);
});

// Typing a size or budget, or moving a weight, re-ranks as you go; the
// field keeps its focus. A size or budget that isn't sensible is marked
// and ignored until it is.
const FIELDS = {
  sqft: { key: "sqft", ok: (v) => v >= 50 && v <= 5000 },
  budget: { key: "budget", ok: (v) => v >= 1000, blank: null },
};

panel.addEventListener("input", (event) => {
  if (event.target.id === "ask-input") state.conversation.draft = event.target.value;
  if (event.target.dataset.weight) {
    state.plan.weights = { ...state.plan.weights, [event.target.dataset.weight]: Number(event.target.value) };
    updateWeights(regions.body, state.plan.weights);
    render({ resultsOnly: true });
    return;
  }
  const field = FIELDS[event.target.id];
  if (!field) return;
  const raw = event.target.value.trim();
  const value = Number(raw);
  const blank = raw === "" && "blank" in field;
  const ok = blank || (raw !== "" && Number.isFinite(value) && field.ok(value));
  event.target.setAttribute("aria-invalid", String(!ok));
  if (!ok) return;
  state.plan[field.key] = blank ? field.blank : value;
  render({ resultsOnly: true });
});

panel.addEventListener("change", (event) => {
  if (event.target.dataset.compareSlot) {
    const slot = event.target.dataset.compareSlot;
    state.compare[Number(slot)] = event.target.value;
    openCompare(state.compare);
    drawer.querySelector(`[data-compare-slot="${slot}"]`)?.focus();
    return;
  }
  if (event.target.id !== "include-low") return;
  state.plan.includeLow = event.target.checked;
  render();
  document.getElementById("include-low")?.focus();
});

// The fine-tune section stays open across re-renders once opened.
panel.addEventListener("toggle", (event) => {
  if (event.target.id === "fine-tune") state.fineTune = event.target.open;
}, true);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !drawer.hidden) closeDrawer();
});

function ranking() {
  return rank(data.wards, state.plan, data.rent);
}

function render({ resultsOnly = false } = {}) {
  const ranked = ranking();
  const view = { ...data, ranking: ranked, conversation: state.conversation };
  if (resultsOnly) renderResults(regions.body, state, view);
  else renderPanel(regions, state, view);
  map.render({ category: state.plan.category, meta: data.meta, pois: data.pois, wards: data.wards,
    picks: ranked.slice(0, 5).map(({ feature }) => feature), fit: fit() });
  writeHash();
  wireRows();
}

// Every ward's score, rent and, if the brief leaves it out, why: the map
// colours and labels wards from this.
function fit() {
  const p = state.plan;
  return new Map(data.wards.map(({ properties: w }) => [w.name, {
    score: parts(w, p.category, p.weights).total,
    rent: monthlyRent(data.rent, w, p.sqft),
    out: leftOut(w, p, data.rent),
  }]));
}

function openCompare(names) {
  state.compare = names;
  openDrawer(compareHtml(names, { ...data, plan: state.plan }));
}

// The URL holds the whole brief, so the link is the shortlist.
async function share() {
  const status = document.getElementById("share-status");
  try {
    await navigator.clipboard.writeText(location.href);
    status.textContent = "Link copied";
  } catch {
    status.textContent = "Copy the link from the address bar";
  }
}

// localStorage can be missing or blocked; the site works without it.
function stored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not remembered, that's all */ }
}

// Hovering or focusing a row finds its marker; scores count from their
// previous values, so a change of input visibly re-ranks the list.
function wireRows() {
  const rows = [...regions.body.querySelectorAll("[data-action=pick]")];
  const counts = [];
  for (const row of rows) {
    const index = Number(row.dataset.value);
    for (const [type, on] of [["mouseenter", true], ["mouseleave", false], ["focus", true], ["blur", false]]) {
      row.addEventListener(type, () => map.highlightPick(index, on));
    }
    const element = row.querySelector(".pick-score");
    const to = Number(element.dataset.score);
    const from = shown.get(row.dataset.name);
    if (from !== undefined && Math.round(from) !== Math.round(to)) counts.push({ element, from, to });
  }
  if (counts.length) countUp(counts);
  if (rows.length) shown = new Map(rows.map((row) => [row.dataset.name, Number(row.querySelector(".pick-score").dataset.score)]));
}

// The chat: the rule-based engine works out the question and its answer
// from the same data and brief as the map; with a key, the assistant words
// the reply from those facts. Either way the reply names the wards it used.
async function send(text) {
  const question = text.trim();
  const { conversation } = state;
  if (!question || conversation.pending) return;
  const context = { ...data, plan: state.plan, ranking: ranking(), last: conversation.last };
  const builtIn = reply(question, context);
  const history = conversation.messages.map((m) => ({ role: m.role, text: m.text }));
  conversation.messages.push({ role: "user", text: question });
  conversation.draft = "";
  conversation.pending = conversation.ai;
  state.tab = "ask";
  showChat();

  const ai = conversation.ai ? await askGemini(question, context, builtIn, { key: config.geminiKey, history }) : null;
  const answer = ai
    ? { kind: ai.wards.length || builtIn.kind !== "refuse" ? "ai" : "refuse", text: ai.answer, wards: ai.wards,
      plan: builtIn.plan, source: "gemini" }
    : { ...builtIn, source: conversation.ai ? "fallback" : "built-in" };
  conversation.messages.push({ role: "answer", ...answer, wards: answer.wards.map((w) => w.properties.name) });
  if (answer.wards.length) conversation.last = answer.wards;
  conversation.pending = false;
  showChat();
  document.getElementById("ask-input")?.focus();
}

function showChat() {
  if (state.tab !== "ask") return;
  render();
  regions.body.scrollTop = regions.body.scrollHeight;
}

function openWard(name, { fly = false } = {}) {
  const feature = data.wards.find((f) => f.properties.name === name);
  if (!feature) return;
  const index = ranking().findIndex((r) => r.feature === feature);
  const sheetMoved = openDrawer(drawerHtml(feature, {
    plan: state.plan, meta: data.meta, rent: data.rent, position: index >= 0 && index < 5 ? index + 1 : null,
  }));
  map.select(name);
  if (!fly) return;
  // On a phone the sheet just rose; fly once the map has its new size.
  if (sheetMoved) setTimeout(() => map.focusWard(name), SHEET_MS);
  else map.focusWard(name);
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
  (usable ? returnFocus : regions.body.querySelector("h2"))?.focus();
  returnFocus = null;
}

// The URL records the brief, e.g. #qsr/pcmc?for=offices&competition=avoid
// &sqft=450&budget=40000, or #cafe?w=2,1,3,4 for weights of your own, so a
// shortlist can be shared and reopened exactly as it looked. Defaults are
// left out. Older links (#cafe/balanced/all) still open.
function readHash() {
  const [path, query = ""] = decodeURIComponent(location.hash.slice(1)).split("?");
  const [slug, ...rest] = path.split("/");
  const params = new URLSearchParams(query);
  const sqft = Number(params.get("sqft"));
  const budget = Number(params.get("budget"));
  const custom = (params.get("w") ?? "").split(",").map(Number);
  const own = custom.length === COMPONENTS.length && custom.every((w) => Number.isInteger(w) && w >= 0 && w <= 5);
  const customers = params.get("for");
  const competition = params.get("competition");
  const weights = own
    ? Object.fromEntries(COMPONENTS.map((c, i) => [c.key, custom[i]]))
    : weightsFor({
      customers: Object.hasOwn(CUSTOMERS, customers ?? "") ? customers : DEFAULT_BRIEF.customers,
      competition: Object.hasOwn(COMPETITION, competition ?? "") ? competition : DEFAULT_BRIEF.competition,
    });
  return {
    category: Object.keys(CATEGORIES).find((key) => CATEGORIES[key].slug === slug) ?? "cafe",
    weights,
    area: rest.find((segment) => Object.hasOwn(AREAS, segment)) ?? "all",
    sqft: sqft >= 50 && sqft <= 5000 ? sqft : data.rent.default_sqft,
    budget: budget >= 1000 ? budget : null,
    includeLow: params.get("low") === "1",
  };
}

function writeHash() {
  const p = state.plan;
  const params = new URLSearchParams();
  const brief = briefOf(p.weights);
  if (brief.customers && brief.competition) {
    if (brief.customers !== DEFAULT_BRIEF.customers) params.set("for", brief.customers);
    if (brief.competition !== DEFAULT_BRIEF.competition) params.set("competition", brief.competition);
  } else {
    params.set("w", COMPONENTS.map((c) => p.weights[c.key]).join(","));
  }
  if (p.sqft !== data.rent.default_sqft) params.set("sqft", p.sqft);
  if (p.budget) params.set("budget", p.budget);
  if (p.includeLow) params.set("low", "1");
  const query = params.toString().replace(/%2C/g, ",");
  const path = `${CATEGORIES[p.category].slug}${p.area === "all" ? "" : `/${p.area}`}`;
  history.replaceState(null, "", `#${path}${query ? `?${query}` : ""}`);
}

if (data) {
  map.fitData(data.wards);
  render();
}
