import { reply, wardIndex } from "./chat.js";
import { drawerHtml } from "./drawer.js";
import { CATEGORIES } from "./format.js";
import { createMap } from "./map.js";
import { methodHtml } from "./method.js";
import { countUp } from "./motion.js";
import { renderLoadError, renderPanel, renderResults } from "./panel.js";
import { AREAS, LENSES, rank } from "./score.js";
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

// The key is optional (and absent on the published site), so a missing
// config just means OpenStreetMap tiles.
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

const state = {
  tab: "plan",
  plan: data ? readHash() : null,
  conversation: { messages: [], draft: "", last: [] },
};
let shown = new Map();
let returnFocus = null;
// Matches the sheet's height transition in localio.css.
const SHEET_MS = 260;

// Setting a plan value from a button, the chat or the empty state.
const PARSE = {
  category: String, lens: String, area: String,
  budget: (v) => (v === "" || v === null ? null : Number(v)),
  sqft: Number,
  includeLow: (v) => v === true || v === "true",
};

const actions = {
  set: (control) => { state.plan[control.dataset.key] = PARSE[control.dataset.key](control.dataset.value); },
  tab: (control) => { state.tab = control.dataset.value; },
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

// Typing a size or budget re-ranks as you type; the field keeps its focus.
// A value that isn't sensible is marked and ignored until it is.
const FIELDS = {
  sqft: { key: "sqft", ok: (v) => v >= 50 && v <= 5000 },
  budget: { key: "budget", ok: (v) => v >= 1000, blank: null },
};

panel.addEventListener("input", (event) => {
  if (event.target.id === "ask-input") state.conversation.draft = event.target.value;
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
  if (event.target.id !== "include-low") return;
  state.plan.includeLow = event.target.checked;
  render();
  document.getElementById("include-low")?.focus();
});

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
    picks: ranked.slice(0, 5).map(({ feature }) => feature) });
  writeHash();
  wireRows();
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

// The chat answers in the browser from the same data and plan as the map.
function send(text) {
  const question = text.trim();
  if (!question) return;
  const { conversation } = state;
  const answer = reply(question, { ...data, plan: state.plan, ranking: ranking(), last: conversation.last });
  conversation.messages.push({ role: "user", text: question });
  conversation.messages.push({ role: "answer", ...answer, wards: answer.wards.map((w) => w.properties.name) });
  if (answer.wards.length) conversation.last = answer.wards;
  conversation.draft = "";
  state.tab = "ask";
  render();
  regions.body.scrollTop = regions.body.scrollHeight;
  document.getElementById("ask-input")?.focus();
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

// The URL records the plan, e.g. #qsr/busy/pcmc?sqft=450&budget=40000, so
// a shortlist can be shared and reopened exactly as it looked.
function readHash() {
  const [path, query = ""] = decodeURIComponent(location.hash.slice(1)).split("?");
  const [slug, lens, area] = path.split("/");
  const params = new URLSearchParams(query);
  const sqft = Number(params.get("sqft"));
  const budget = Number(params.get("budget"));
  return {
    category: Object.keys(CATEGORIES).find((key) => CATEGORIES[key].slug === slug) ?? "cafe",
    lens: Object.hasOwn(LENSES, lens ?? "") ? lens : "balanced",
    area: Object.hasOwn(AREAS, area ?? "") ? area : "all",
    sqft: sqft >= 50 && sqft <= 5000 ? sqft : data.rent.default_sqft,
    budget: budget >= 1000 ? budget : null,
    includeLow: params.get("low") === "1",
  };
}

function writeHash() {
  const p = state.plan;
  const params = new URLSearchParams();
  if (p.sqft !== data.rent.default_sqft) params.set("sqft", p.sqft);
  if (p.budget) params.set("budget", p.budget);
  if (p.includeLow) params.set("low", "1");
  const query = params.toString();
  history.replaceState(null, "", `#${CATEGORIES[p.category].slug}/${p.lens}/${p.area}${query ? `?${query}` : ""}`);
}

if (data) {
  map.fitData(data.wards);
  render();
}
