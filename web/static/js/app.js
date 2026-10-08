import { parsePlan, reply, wardIndex } from "./chat.js";
import { compareHtml, SLOTS } from "./compare.js";
import { calcRows, drawerHtml } from "./drawer.js";
import { CATEGORIES, escapeHtml } from "./format.js";
import { diff } from "./insight.js";
import { askGemini } from "./llm.js";
import { createMap, LAYERS } from "./map.js";
import { marketHtml } from "./market.js";
import { methodHtml } from "./method.js";
import { countUp, measure, play } from "./motion.js";
import { createPalette } from "./palette.js";
import { renderLoadError, renderPanel, renderResults, updateWeights } from "./panel.js";
import {
  AREAS, briefOf, COMPETITION, COMPONENTS, CUSTOMERS, DEFAULT_BRIEF, leftOut, monthlyRent, parts, rank, weightsFor,
} from "./score.js";
import { downloadCsv, printHtml, shareHtml, summaryText } from "./share.js";
import { enableSheet } from "./sheet.js";

const panel = document.getElementById("panel");
const drawer = document.getElementById("drawer");
const shareDialog = document.getElementById("share");
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
// tiles, and without an assistant key the analyst gives its own answers.
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
const THEME_KEY = "localio.theme";

const state = {
  tab: "plan",
  // explore, compare, market or method: which view the top bar marks.
  view: "explore",
  plan: data ? readHash() : null,
  // The intro explains what the product is for until it's dismissed once.
  intro: stored(INTRO_KEY) !== "seen",
  fineTune: false,
  compare: [],
  // The last brief and its ranking, and an optional pinned baseline: what
  // the "what changed" strip compares against.
  last: null,
  baseline: null,
  change: null,
  conversation: { messages: [], draft: "", last: [], pending: false, ai: Boolean(config.geminiKey) },
};
let shown = new Map();
let returnFocus = null;
// Matches the sheet's height transition in localio.css.
const SHEET_MS = 260;

// Setting a plan value from a button, the analyst, the palette or the
// empty state.
const PARSE = {
  category: String, area: String,
  budget: (v) => (v === "" || v === null ? null : Number(v)),
  sqft: Number,
  includeLow: (v) => v === true || v === "true",
};

function defaultPlan() {
  return { category: "cafe", weights: weightsFor(DEFAULT_BRIEF), area: "all", sqft: data.rent.default_sqft, budget: null, includeLow: false };
}

// Actions that change the brief or the panel, then re-render it.
const actions = {
  set: (control) => { state.plan[control.dataset.key] = PARSE[control.dataset.key](control.dataset.value); },
  category: (control) => { state.plan.category = control.dataset.value; },
  area: (control) => { state.plan.area = control.dataset.value; },
  customers: (control) => { state.plan.weights = { ...state.plan.weights, ...CUSTOMERS[control.dataset.value].weights }; },
  competition: (control) => { state.plan.weights = { ...state.plan.weights, room: COMPETITION[control.dataset.value].room }; },
  tab: (control) => { state.tab = control.dataset.value; },
  reset: () => { state.plan = defaultPlan(); },
  baseline: (control) => {
    state.baseline = control.dataset.value === "pin" ? state.last : null;
    state.change = null;
  },
  "dismiss-intro": () => {
    state.intro = false;
    store(INTRO_KEY, "seen");
  },
  apply: (control) => {
    Object.assign(state.plan, state.conversation.messages[Number(control.dataset.value)].plan);
    state.tab = "plan";
  },
};

// Actions that open something, ask a question or act outside the panel;
// they don't re-render the brief.
const quiet = {
  pick: (control) => openWard(ranking()[Number(control.dataset.value)].feature.properties.name, { fly: true }),
  "open-ward": (control) => openWard(control.dataset.value, { fly: true }),
  "close-drawer": () => closeDrawer(),
  method: () => openView("method"),
  sources: () => openView("method", "method-sources"),
  jump: (control) => drawer.querySelector(`#${control.dataset.value}`)?.scrollIntoView({ behavior: "smooth", block: "start" }),
  nav: (control, event) => {
    event?.preventDefault();
    if (control.dataset.value === "explore") {
      closeDrawer();
      if (state.tab !== "plan") {
        state.tab = "plan";
        render();
      }
      regions.body.querySelector("h2")?.focus();
    } else openView(control.dataset.value);
  },
  compare: () => openView("compare"),
  // This ward first, then the best of the shortlist that isn't it.
  "compare-with": (control) => {
    const others = ranking().map(({ feature }) => feature.properties.name).filter((name) => name !== control.dataset.value);
    openCompare([control.dataset.value, ...others].slice(0, SLOTS));
  },
  palette: () => palette?.open(),
  theme: () => toggleTheme(),
  "share-dialog": () => openShare(),
  "close-share": () => shareDialog.close(),
  "copy-link": () => copy(location.href, "Link copied"),
  "copy-summary": () => copy(summaryText(view()), "Summary copied"),
  "export-csv": () => downloadCsv(view()),
  print: () => {
    document.getElementById("print-root").innerHTML = printHtml(view());
    shareDialog.close();
    window.print();
  },
  ask: (control) => send(control.dataset.value),
  "ask-ward": (control) => {
    closeDrawer();
    state.tab = "ask";
    send(`Tell me about ${control.dataset.value}`);
  },
};

document.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (!control || !data) return;
  const { action } = control.dataset;
  if (quiet[action]) {
    quiet[action](control, event);
    return;
  }
  if (!actions[action]) return;
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
  if (event.target.dataset.calcInput) {
    updateCalc(event.target.closest("[data-calc]"));
    return;
  }
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
  if (event.target.dataset.calcInput) {
    updateCalc(event.target.closest("[data-calc]"));
    return;
  }
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

// The adjust-the-model section stays open across re-renders once opened.
panel.addEventListener("toggle", (event) => {
  if (event.target.id === "fine-tune") state.fineTune = event.target.open;
}, true);

document.addEventListener("keydown", (event) => {
  const typing = event.target.matches("input, textarea, select, [contenteditable]");
  if ((event.key === "k" || event.key === "K") && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    palette?.open();
  } else if (event.key === "/" && !typing && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    palette?.open();
  } else if (event.key === "Escape" && !drawer.hidden && !document.querySelector("dialog[open]")) {
    closeDrawer();
  }
});

function ranking() {
  return rank(data.wards, state.plan, data.rent);
}

function view() {
  return { ...data, plan: state.plan, ranking: ranking() };
}

function samePlan(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function render({ resultsOnly = false } = {}) {
  const ranked = ranking();
  // What changed: against the pinned baseline if there is one, else against
  // the previous brief. Re-renders that don't change the brief keep the last.
  const snapshot = { plan: structuredClone(state.plan), ranking: ranked };
  if (state.baseline) state.change = samePlan(state.baseline.plan, state.plan) ? null : diff(state.baseline, snapshot, data);
  else if (state.last && !samePlan(state.last.plan, state.plan)) state.change = diff(state.last, snapshot, data);
  state.last = snapshot;

  const before = measure(regions.body.querySelectorAll(".pick"));
  const panelView = { ...data, ranking: ranked, conversation: state.conversation };
  if (resultsOnly) renderResults(regions.body, state, panelView);
  else renderPanel(regions, state, panelView);
  play(before, regions.body.querySelectorAll(".pick"));
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

function openView(name, scrollTo) {
  if (name === "compare") {
    openCompare(ranking().slice(0, SLOTS).map(({ feature }) => feature.properties.name));
    return;
  }
  const html = name === "market" ? marketHtml(view()) : methodHtml(data);
  openDrawer(html, { wide: true, view: name });
  if (scrollTo) drawer.querySelector(`#${scrollTo}`)?.scrollIntoView({ block: "start" });
}

function openCompare(names) {
  state.compare = names;
  openDrawer(compareHtml(names, { ...data, plan: state.plan }), { wide: true, view: "compare" });
}

// ---- Share, copy, theme --------------------------------------------------

function openShare() {
  shareDialog.innerHTML = shareHtml(view());
  shareDialog.showModal();
  shareDialog.querySelector("[data-action=copy-link]").focus();
}

shareDialog.addEventListener("click", (event) => { if (event.target === shareDialog) shareDialog.close(); });

async function copy(text, done) {
  const status = document.getElementById("share-status");
  try {
    await navigator.clipboard.writeText(text);
    if (status) status.textContent = done;
  } catch {
    if (status) status.textContent = "Copy the link from the address bar";
  }
}

function toggleTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  const next = dark ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  store(THEME_KEY, next);
  labelTheme();
  map.setTheme();
}

function labelTheme() {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.querySelector("[data-action=theme]").setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  labelTheme();
  map.setTheme();
});
labelTheme();

// localStorage can be missing or blocked; the site works without it.
function stored(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function store(key, value) {
  try { localStorage.setItem(key, value); } catch { /* not remembered, that's all */ }
}

// Hovering or focusing a row finds its marker and ward; scores count from
// their previous values, so a change of input visibly re-ranks the list.
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

function updateCalc(calc) {
  if (!calc) return;
  const read = (key) => Number(calc.querySelector(`[data-calc-input="${key}"]`).value);
  const ticket = read("ticket");
  const days = read("days");
  const share = read("share");
  if (!(ticket > 0 && days > 0 && days <= 31 && share > 0)) return;
  calc.querySelector(".calc-out").innerHTML = calcRows(Number(calc.dataset.rent), { ticket, days, share });
}

// ---- The analyst ---------------------------------------------------------
// The rule-based engine works out the question and its answer from the same
// data and brief as the map; with a key, the assistant words the reply from
// those facts. Either way the reply names the wards it used, and keeps the
// brief its question implied, so its evidence matches its words.
async function send(text) {
  const question = text.trim();
  const { conversation } = state;
  if (!question || conversation.pending) return;
  const context = { ...data, plan: state.plan, ranking: ranking(), last: conversation.last };
  const builtIn = reply(question, context);
  const brief = parsePlan(question, state.plan).plan;
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
  conversation.messages.push({ role: "answer", ...answer, brief, wards: answer.wards.map((w) => w.properties.name) });
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

// ---- Drawers -------------------------------------------------------------

function openWard(name, { fly = false } = {}) {
  const feature = data.wards.find((f) => f.properties.name === name);
  if (!feature) return;
  const ranked = ranking();
  const index = ranked.findIndex((r) => r.feature === feature);
  const sheetMoved = openDrawer(drawerHtml(feature, {
    plan: state.plan, meta: data.meta, rent: data.rent, wards: data.wards,
    position: index >= 0 && index < 5 ? index + 1 : null, of: ranked.length,
  }), { view: "explore" });
  map.select(name);
  if (!fly) return;
  // On a phone the sheet just rose; fly once the map has its new size.
  if (sheetMoved) setTimeout(() => map.focusWard(name), SHEET_MS);
  else map.focusWard(name);
}

// The ward drawer slides over the panel, never the map: the map is the
// context. Compare, Market and Methodology are reading views and widen
// over part of the map on a large screen.
function openDrawer(html, { wide = false, view: name = "explore" } = {}) {
  if (drawer.hidden) returnFocus = document.activeElement;
  drawer.innerHTML = html;
  drawer.classList.toggle("wide", wide);
  drawer.hidden = false;
  drawer.scrollTop = 0;
  requestAnimationFrame(() => drawer.classList.add("open"));
  drawer.querySelector("#drawer-title").focus();
  setView(name);
  return sheet.expand();
}

function closeDrawer() {
  if (drawer.hidden) return;
  drawer.classList.remove("open", "wide");
  drawer.hidden = true;
  map.select(null);
  setView("explore");
  const usable = returnFocus?.isConnected && returnFocus !== document.body && !returnFocus.closest("dialog");
  (usable ? returnFocus : regions.body.querySelector("h2"))?.focus();
  returnFocus = null;
}

function setView(name) {
  state.view = name;
  for (const link of document.querySelectorAll(".nav-link")) {
    const value = link.dataset.action === "method" ? "method" : link.dataset.value;
    if (value === name) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

// ---- The URL is the brief ------------------------------------------------
// e.g. #qsr/pcmc?for=offices&competition=avoid&sqft=450&budget=40000, or
// #cafe?w=2,1,3,4 for weights of your own, so a shortlist can be shared and
// reopened exactly as it looked. Defaults are left out. Older links
// (#cafe/balanced/all) still open.
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

// ---- Data status: the top bar's pill and the strip under the map ---------

function dataStatus() {
  const { meta, wards } = data;
  const date = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const src = Object.fromEntries((meta.sources ?? []).map((s) => [s.id, s]));
  const total = (key) => wards.reduce((sum, w) => sum + w.properties.draws[key], 0);
  const bar = document.getElementById("statusbar");
  bar.innerHTML = `
    <span class="status-group"><span><strong>${wards.length}</strong> wards</span>
      <span><strong>${meta.outlets.toLocaleString("en-US")}</strong> food &amp; drink outlets</span>
      <span class="status-draws"><strong>${total("offices")}</strong> offices</span><span class="status-draws"><strong>${total("colleges")}</strong> colleges</span>
      <span class="status-draws"><strong>${total("stations")}</strong> stations</span></span>
    <span class="status-group status-sources"><span>Outlets: OSM ${escapeHtml(src.outlets ? date(src.outlets.retrieved_at) : "")}</span>
      <span>Residents: Census ${escapeHtml(src.population?.as_of ?? "")}</span><span>Rent: ${escapeHtml(quarter(src.rent_streets?.as_of))}</span></span>
    <span class="status-group"><button class="status-ok" data-action="sources">All pipeline checks passed</button>
      <span>Built ${escapeHtml(date(meta.generated_at))}</span></span>`;
  bar.hidden = false;
}

// "2026-06-30" -> "Q2 2026": how rent reports name their period.
function quarter(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
}

// ---- The command palette -------------------------------------------------

function paletteCommands() {
  const go = (fn) => () => fn();
  const setPlan = (key, value) => {
    state.plan[key] = value;
    closeDrawer();
    state.tab = "plan";
    render();
  };
  const list = [
    { group: "Views", label: "Explore the shortlist", keywords: "home brief", run: go(() => quiet.nav({ dataset: { value: "explore" } })) },
    { group: "Views", label: "Compare the top 3", keywords: "compare wards", run: go(() => openView("compare")) },
    { group: "Views", label: "Market overview", keywords: "insights charts city", run: go(() => openView("market")) },
    { group: "Views", label: "Methodology and sources", keywords: "how it works data sources licence", run: go(() => openView("method")) },
    { group: "Views", label: "Ask the analyst", keywords: "chat question", run: go(() => { closeDrawer(); state.tab = "ask"; render(); document.getElementById("ask-input")?.focus(); }) },
    ...Object.entries(CATEGORIES).map(([key, c]) => ({ group: "Brief", label: `Format: ${c.label}`, keywords: c.note, run: go(() => setPlan("category", key)) })),
    ...Object.entries(AREAS).map(([key, label]) => ({ group: "Brief", label: `Area: ${label}`, keywords: key, run: go(() => setPlan("area", key)) })),
    ...Object.entries(CUSTOMERS).map(([key, c]) => ({ group: "Brief", label: `Customers: ${c.label}`, keywords: c.hint,
      run: go(() => setPlan("weights", { ...state.plan.weights, ...CUSTOMERS[key].weights })) })),
    ...Object.entries(COMPETITION).map(([key, c]) => ({ group: "Brief", label: `Competition: ${c.label}`, keywords: "tolerance",
      run: go(() => setPlan("weights", { ...state.plan.weights, room: COMPETITION[key].room })) })),
    { group: "Brief", label: "Remove the rent ceiling", keywords: "budget", run: go(() => setPlan("budget", null)) },
    { group: "Brief", label: "Reset the brief", keywords: "clear default", run: go(() => { state.plan = defaultPlan(); render(); }) },
    ...Object.entries(LAYERS).map(([key, l]) => ({ group: "Map layer", label: `Show ${l.label.toLowerCase()}`, keywords: "map layer colour",
      run: go(() => map.setLayer(key)) })),
    { group: "Map layer", label: "Fit all wards in view", keywords: "reset zoom", run: go(() => map.resetView()) },
    { group: "Share", label: "Share analysis", keywords: "link copy", run: go(openShare) },
    { group: "Share", label: "Export shortlist as CSV", keywords: "download spreadsheet", run: go(() => downloadCsv(view())) },
    { group: "Share", label: "Switch theme", keywords: "dark light", run: go(toggleTheme) },
  ];
  return { list, openWard: (name) => openWard(name, { fly: true }), set: setPlan };
}

let palette = null;

if (data) {
  // Render first: framing the wards measures the filled-in legend.
  render();
  map.fitData(data.wards);
  dataStatus();
  palette = createPalette(document.getElementById("palette"), { wards: data.wards, commands: paletteCommands() });
}
