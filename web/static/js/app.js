import { CATEGORIES } from "./format.js";
import { createMap } from "./map.js";
import { renderPanel, STEPS } from "./panel.js";
import { cityRating, LENSES, rank } from "./score.js";

const panel = document.getElementById("panel-body");
const sheetHandle = document.getElementById("sheet-handle");

// On phones the panel is a bottom sheet that can shrink to its header.
sheetHandle.addEventListener("click", () => {
  const collapsed = document.body.classList.toggle("sheet-collapsed");
  sheetHandle.setAttribute("aria-expanded", String(!collapsed));
  sheetHandle.setAttribute("aria-label", collapsed ? "Show panel" : "Hide panel");
});

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

// The key is optional, so a missing config just means OpenStreetMap tiles.
const config = await getJson("config.json").catch(() => ({}));
const map = createMap(document.getElementById("map"), { cartoKey: config.cartoKey });

const [pois, localities] = await Promise.all([
  getJson("data/pois.geojson"),
  getJson("data/localities.geojson"),
]);

const state = readHash();

const actions = {
  category: (value) => { state.category = value; },
  lens: (value) => { state.lens = value; },
  next: () => { state.step += 1; },
  back: () => { state.step -= 1; },
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
  const ranking = state.step === 3 ? rank(localities.features, state.category, state.lens) : [];
  renderPanel(panel, state, {
    meta: localities.meta,
    localities: localities.features,
    ranking,
    averageRating: state.category && cityRating(pois.features, state.category),
  });
  map.render({
    step: state.step,
    category: state.category,
    lens: state.lens,
    meta: localities.meta,
    pois: pois.features,
    localities: localities.features,
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

render();
