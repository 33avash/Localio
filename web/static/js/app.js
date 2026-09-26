import { CATEGORIES } from "./format.js";
import { createMap } from "./map.js";
import { renderLoadError, renderPanel, STEPS } from "./panel.js";
import { cityRating, LENSES, rank } from "./score.js";
import { enableSheet } from "./sheet.js";

const panel = document.getElementById("panel");
const regions = {
  rail: document.getElementById("panel-rail"),
  body: document.getElementById("panel-body"),
  foot: document.getElementById("panel-foot"),
};

enableSheet(panel, document.getElementById("sheet-handle"));

async function getJson(url) {
  const response = await fetch(url).catch(() => {
    throw new Error(`${url}: no response from the server`);
  });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

// The key is optional, so a missing config just means OpenStreetMap tiles.
const config = await getJson("config.json").catch(() => ({}));
const map = createMap(document.getElementById("map"), { cartoKey: config.cartoKey });

// A failed load says so in the panel, where people are looking, rather
// than leaving a blank map and an error in the console.
async function loadData() {
  try {
    const [pois, localities] = await Promise.all([
      getJson("data/pois.geojson"),
      getJson("data/localities.geojson"),
    ]);
    if (!pois.features?.length || !localities.features?.length) throw new Error("The GeoJSON files are empty.");
    return { pois: pois.features, localities: localities.features, meta: localities.meta };
  } catch (error) {
    renderLoadError(regions.body, error.message);
    return null;
  }
}

const data = await loadData();

const state = readHash();

const actions = {
  category: (value) => { state.category = value; },
  lens: (value) => { state.lens = value; },
  next: () => { state.step += 1; },
  goto: (value) => { state.step = Number(value); },
  restart: () => {
    Object.assign(state, { step: 1, category: null, lens: null });
    map.resetView();
  },
};

panel.addEventListener("click", (event) => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  // A shortlist row only moves the map; re-rendering would close its popup.
  if (control.dataset.action === "pick") {
    map.focusPick(Number(control.dataset.value));
    return;
  }
  const previousStep = state.step;
  actions[control.dataset.action](control.dataset.value);
  render();
  restoreFocus(control, state.step !== previousStep);
});

function render() {
  const ranking = state.step === 3 ? rank(data.localities, state.category, state.lens) : [];
  renderPanel(regions, state, {
    meta: data.meta,
    localities: data.localities,
    ranking,
    averageRating: state.category && cityRating(data.pois, state.category),
  });
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
}

// Re-rendering replaces the panel's buttons, so put keyboard focus back:
// on the new heading after a step change, otherwise on the same control.
function restoreFocus(control, stepChanged) {
  const { action, value } = control.dataset;
  const selector = stepChanged ? "h2" : `[data-action="${action}"]${value ? `[data-value="${value}"]` : ""}`;
  panel.querySelector(selector)?.focus();
}

// The URL hash mirrors the flow (#shortlist/qsr/footfall), so a shortlist
// can be reloaded or shared.
function readHash() {
  const [stepName, slug, lens] = decodeURIComponent(location.hash.slice(1)).split("/");
  const category = Object.keys(CATEGORIES).find((key) => CATEGORIES[key].slug === slug) ?? null;
  const knownLens = Object.hasOwn(LENSES, lens ?? "") ? lens : null;
  let step = Math.max(1, STEPS.findIndex((name) => name.toLowerCase() === stepName) + 1);
  if (!category) step = 1;
  else if (step === 3 && !knownLens) step = 2;
  return { step, category, lens: knownLens };
}

function writeHash() {
  const parts = [STEPS[state.step - 1].toLowerCase(), CATEGORIES[state.category]?.slug, state.lens];
  const hash = state.category ? `#${parts.filter(Boolean).join("/")}` : "";
  history.replaceState(null, "", hash || location.pathname);
}

if (data) {
  map.fitData(data.localities);
  render();
}
