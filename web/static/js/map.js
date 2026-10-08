import { CATEGORIES, escapeHtml, num, rupees } from "./format.js";
import { confidence, FIT_BREAKS, FIT_LABELS, fitBand } from "./insight.js";
import { reducedMotion } from "./motion.js";
import { outletPopup } from "./popups.js";
import { standing } from "./score.js";

// Only a starting point while data loads; fitData() then frames the wards.
const PUNE = [18.5204, 73.8567];

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const COLORS = {
  cafe: "#4F79A8",
  fast_food: "#B5476B",
  restaurant: "#9A958C",
  other: "#6B6E73",
};

// Outlets per 10,000 residents, five quantile classes. Pale sand, amber,
// burnt orange to deep rust, well away from the green accent, so "crowded"
// never reads as "recommended". Class 0 (none mapped) is a neutral grey.
export const DENSITY = ["#D9D7D2", "#F6E3B4", "#EDB65A", "#D9782C", "#A94A1C", "#662611"];

// The score for the brief, in the fixed fit bands: pale to deep green.
// Wards the brief leaves out (another area, over budget, thin data) are grey.
export const FIT = ["#CFE5D8", "#9CCBB2", "#62AC89", "#338766", "#175C45"];
const LEFT_OUT = "#C9C4B8";

// A ward's standing (0 to 1) on residents, eating out or daytime draw, in
// quintiles of one blue, so a people layer never looks like the fit score.
const STANDING = ["#E4ECF2", "#BDD1E1", "#8CB0CC", "#5787AE", "#2D5D84"];
// Rent tiers, cheapest to dearest, in warm greys.
const RENT = ["#EFE9DC", "#D8CCB4", "#B7A587", "#8C7A5E", "#5E5039"];
const TIERS = ["emerging", "value", "mid", "high", "premium"];
// Data confidence: a status scale, always shown with its label.
const CONFIDENCE = { High: "#2F7A55", Medium: "#D7A54A", Low: "#C9C3B6" };

export const LAYERS = {
  fit: { label: "Fit score", swatch: FIT[3] },
  competition: { label: "Competition", swatch: DENSITY[3] },
  rent: { label: "Rent tier", swatch: RENT[3] },
  daytime: { label: "Daytime draw", swatch: STANDING[3] },
  eating_out: { label: "Eating out", swatch: STANDING[2] },
  residents: { label: "Residents", swatch: STANDING[1] },
  confidence: { label: "Data confidence", swatch: CONFIDENCE.Medium },
};

const POPUP = { className: "localio-popup", minWidth: 220, maxWidth: 290 };

// Numbered markers closer than this on screen get pushed apart.
const MIN_GAP_PX = 34;

// onSelect(name) runs when an area or a numbered marker is clicked;
// onLayer(name) when the layer changes.
export function createMap(element, { cartoKey, onSelect, onLayer = () => {} }) {
  const map = L.map(element, {
    center: PUNE,
    zoom: 12,
    maxZoom: 16,
    maxBoundsViscosity: 0.8,
    // Quarter steps let fitData() frame the wards closely on any screen.
    zoomSnap: 0.25,
  });
  let dataBounds = null;
  const tiles = basemap(cartoKey, theme()).addTo(map);
  element.classList.toggle("basemap-osm", !cartoKey);
  watchTiles(map, tiles, element);

  // Leaflet measures its container once; any later size change (the phone
  // sheet moving, a breakpoint) needs a re-measure.
  new ResizeObserver(() => map.invalidateSize()).observe(element);

  // Hover labels only where there's a hover; on touch a tap opens the drawer.
  const canHover = window.matchMedia("(hover: hover)").matches;
  const closeLabels = () => map.eachLayer((layer) => layer.closeTooltip?.());
  map.on("movestart zoomstart click", closeLabels);
  // The layer list folds away once the map is used.
  map.on("click movestart", () => { if (layersOpen) { layersOpen = false; drawControls(); } });

  // Outlet dots get their own pane above the areas.
  map.createPane("outlets").style.zIndex = 450;

  const areas = L.layerGroup().addTo(map);
  const hatching = L.layerGroup().addTo(map);
  const outlets = L.layerGroup().addTo(map);
  const picks = L.layerGroup().addTo(map);
  const leaders = L.layerGroup().addTo(map);
  let pickMarkers = [];
  // Built once on the first render, then only restyled, so changing a layer
  // or the brief fades the colours instead of redrawing 140 polygons.
  const areaLayers = new Map();
  let selected = null;
  let hovered = null;
  let lastView = null;
  let outletsOn = false;
  let mode = "fit";
  let band = null;
  let layersOpen = false;

  const layersControl = L.control({ position: "topright" });
  layersControl.onAdd = () => {
    const div = L.DomUtil.create("div", "layers");
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.disableScrollPropagation(div);
    div.addEventListener("click", (event) => {
      // Re-rendering detaches the clicked button, so Leaflet could no longer
      // tell the click came from a control: keep it off the map.
      event.stopPropagation();
      if (event.target.closest(".layers-toggle")) {
        layersOpen = true;
        drawControls();
        return;
      }
      const button = event.target.closest("[data-mode]");
      if (!button) return;
      layersOpen = false;
      setLayer(button.dataset.mode);
      drawControls();
      layersControl.getContainer().querySelector(".layers-toggle")?.focus();
    });
    return div;
  };
  layersControl.addTo(map);

  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    L.DomEvent.disableClickPropagation(div);
    div.addEventListener("change", (event) => {
      if (!event.target.matches("[data-toggle=outlets]")) return;
      outletsOn = event.target.checked;
      drawOutlets(lastView);
    });
    div.addEventListener("click", (event) => {
      const button = event.target.closest("[data-band]");
      if (!button) return;
      const value = Number(button.dataset.band);
      band = band === value ? null : value;
      styleAreas(lastView);
      drawControls();
      legend.getContainer().querySelector(`[data-band="${value}"]`)?.focus();
    });
    return div;
  };
  legend.addTo(map);

  const reset = L.control({ position: "topleft" });
  reset.onAdd = () => {
    const div = L.DomUtil.create("div", "leaflet-bar");
    div.innerHTML = '<a href="#" role="button" title="Fit all wards" aria-label="Fit all wards in view">⤢</a>';
    L.DomEvent.disableClickPropagation(div);
    div.firstChild.addEventListener("click", (event) => { event.preventDefault(); resetView(); });
    return div;
  };
  reset.addTo(map);

  function render(view) {
    lastView = view;
    map.closePopup();
    if (!areaLayers.size) buildAreas(view);
    styleAreas(view);
    drawOutlets(view);
    drawPicks(view);
    drawControls();
  }

  function drawControls() {
    if (!lastView) return;
    const layers = layersControl.getContainer();
    layers.classList.toggle("open", layersOpen);
    layers.innerHTML = `
      <button type="button" class="layers-toggle" aria-expanded="${layersOpen}">
        <span class="layer-swatch" style="background:${LAYERS[mode].swatch}"></span>${LAYERS[mode].label}</button>
      <p class="eyebrow">Map layer</p>
      <div class="layer-list" role="group" aria-label="Colour wards by">${Object.entries(LAYERS).map(([key, l]) =>
        `<button type="button" data-mode="${key}" aria-pressed="${key === mode}">
          <span class="layer-swatch" style="background:${l.swatch}"></span>${l.label}</button>`).join("")}</div>`;
    const box = legend.getContainer();
    box.classList.toggle("filtering", band !== null && mode === "fit");
    box.innerHTML = legendHtml(lastView, mode, band, outletsOn);
  }

  function setLayer(next) {
    if (!LAYERS[next] || next === mode) return;
    mode = next;
    band = null;
    styleAreas(lastView);
    drawControls();
    onLayer(mode);
  }

  // One polygon per ward, built once. Wards with too few outlets for a
  // confident score get a hatch on top.
  function buildAreas(view) {
    for (const ward of view.wards) {
      const { name } = ward.properties;
      const area = L.geoJSON(ward, { style: { weight: 0.6, opacity: 1 } });
      area.eachLayer((layer) => {
        if (canHover) {
          layer.bindTooltip(() => tipHtml(ward, lastView, mode),
            { sticky: true, direction: "top", offset: [0, -12], className: "area-tip", opacity: 1 });
        }
        layer.on("mouseover", () => { hovered = name; styleArea(name); layer.bringToFront(); });
        layer.on("mouseout", () => { hovered = null; styleArea(name); });
        layer.on("click", () => onSelect(name));
        areaLayers.set(name, { layer, ward });
      });
      area.addTo(areas);
      if (ward.properties.status !== "scored") {
        L.geoJSON(ward, { interactive: false, style: { stroke: false, fillColor: "url(#hatch)", fillOpacity: 1 } }).addTo(hatching);
      }
    }
    ensureHatchPattern(map);
  }

  function styleAreas(view) {
    if (!view) return;
    for (const name of areaLayers.keys()) styleArea(name);
  }

  function styleArea(name) {
    const entry = areaLayers.get(name);
    if (!entry || !lastView) return;
    const { layer, ward } = entry;
    const css = getComputedStyle(document.documentElement);
    const fill = fillFor(ward, lastView, mode, band);
    // On a dark basemap the pale ends of each ramp glare; ease them back.
    if (theme() === "dark") fill.fillOpacity *= 0.82;
    const outline = name === selected
      ? { color: css.getPropertyValue("--accent").trim(), weight: 3, opacity: 1 }
      : name === hovered
        ? { color: css.getPropertyValue("--text").trim(), weight: 2, opacity: 1 }
        : { color: css.getPropertyValue("--ward-stroke").trim(), weight: 0.6, opacity: 1 };
    layer.setStyle({ ...fill, ...outline });
    if (name === selected || name === hovered) layer.bringToFront();
    layer.getElement()?.setAttribute("aria-label", `${ward.properties.name}: ${tipText(ward, lastView, mode)}`);
  }

  // Outlet dots are off until the legend's checkbox turns them on.
  function drawOutlets(view) {
    outlets.clearLayers();
    if (!outletsOn || !view) return;
    const { pois, category } = view;
    const ordered = [...pois].sort((a, b) => (a.properties.category === category) - (b.properties.category === category));
    for (const poi of ordered) {
      const faded = category && poi.properties.category !== category;
      L.circleMarker(latLng(poi), {
        pane: "outlets",
        radius: 4,
        color: "#FFFFFF",
        weight: 1,
        opacity: faded ? 0.15 : 1,
        fillColor: faded ? COLORS.other : COLORS[poi.properties.category],
        fillOpacity: faded ? 0.15 : 0.8,
      })
        .bindPopup(() => outletPopup(poi.properties), POPUP)
        .addTo(outlets);
    }
  }

  function select(name) {
    closeLabels();
    const previous = selected;
    selected = name;
    if (previous) styleArea(previous);
    if (name) styleArea(name);
    pickMarkers.forEach((marker) => marker.getElement()?.classList.toggle("is-selected", marker.wardName === name));
  }

  function focusWard(name) {
    const ward = lastView.wards.find((f) => f.properties.name === name);
    if (!ward) return;
    if (reducedMotion()) map.setView(labelPoint(ward), 14, { animate: false });
    else map.flyTo(labelPoint(ward), 14, { duration: 1.1 });
  }

  // The top 5 are the one loud element on the map. Each sits on its ward's
  // label point, which is always inside the ward.
  function drawPicks(view) {
    picks.clearLayers();
    pickMarkers = view.picks.map((ward, i) => {
      const marker = L.marker(labelPoint(ward), {
        icon: L.divIcon({ className: "pick-marker", html: `<span class="pick-dot">${i + 1}</span>`, iconSize: [28, 28] }),
        title: `${i + 1}. ${ward.properties.name}`,
        keyboard: true,
        zIndexOffset: 1000,
      })
        .on("click", () => onSelect(ward.properties.name))
        .addTo(picks);
      marker.anchor = marker.getLatLng();
      marker.wardName = ward.properties.name;
      if (marker.wardName === selected) marker.getElement()?.classList.add("is-selected");
      return marker;
    });
    spreadPicks();
  }

  // Nearby picks would sit on top of each other when zoomed out. Push any
  // pair closer than MIN_GAP_PX apart and draw a thin line back to each.
  function spreadPicks() {
    leaders.clearLayers();
    if (!pickMarkers.length) return;
    const points = pickMarkers.map((marker) => map.latLngToContainerPoint(marker.anchor));
    for (let round = 0; round < 60; round += 1) {
      let moved = false;
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const gap = points[i].distanceTo(points[j]);
          if (gap >= MIN_GAP_PX) continue;
          const angle = gap > 0.1 ? Math.atan2(points[j].y - points[i].y, points[j].x - points[i].x) : (2 * Math.PI * j) / points.length;
          const push = (MIN_GAP_PX - gap) / 2 + 0.5;
          const step = L.point(Math.cos(angle) * push, Math.sin(angle) * push);
          points[i] = points[i].subtract(step);
          points[j] = points[j].add(step);
          moved = true;
        }
      }
      if (!moved) break;
    }
    const ink = getComputedStyle(document.documentElement).getPropertyValue("--text").trim();
    pickMarkers.forEach((marker, i) => {
      const shown = map.containerPointToLatLng(points[i]);
      marker.setLatLng(shown);
      if (map.latLngToContainerPoint(marker.anchor).distanceTo(points[i]) < 2) return;
      L.polyline([marker.anchor, shown], { color: ink, weight: 1, opacity: 0.8, interactive: false }).addTo(leaders);
      L.circleMarker(marker.anchor, { radius: 2.5, color: "#FFFFFF", weight: 1, fillColor: ink, fillOpacity: 1, interactive: false }).addTo(leaders);
    });
  }
  map.on("zoomend", spreadPicks);

  // Hovering or focusing a shortlist row lifts its marker and outlines its
  // ward, so the one being read is always findable.
  function highlightPick(index, on) {
    const marker = pickMarkers[index];
    if (!marker) return;
    marker.setZIndexOffset(on ? 2000 : 1000);
    marker.getElement()?.classList.toggle("is-highlighted", on);
    hovered = on ? marker.wardName : null;
    styleArea(marker.wardName);
  }

  function fitData(wards) {
    map.invalidateSize();
    dataBounds = L.geoJSON({ type: "FeatureCollection", features: wards }).getBounds();
    map.fitBounds(dataBounds, { ...framing(), maxZoom: 13, animate: false });
    map.setMaxBounds(dataBounds.pad(0.15));
    map.setMinZoom(map.getZoom() - 1);
  }

  function resetView() {
    if (dataBounds) map.flyToBounds(dataBounds, { ...framing(), maxZoom: 13, duration: reducedMotion() ? 0 : 0.8 });
  }

  // On a narrow map the legend takes a real share of the corner: frame the
  // wards clear of it, plus a marker's height, since a ward's label point can
  // sit at the very edge of the wards, so no numbered marker starts under it.
  function framing() {
    if (element.clientWidth >= 600) return { padding: [40, 40] };
    const box = legend.getContainer();
    return { paddingTopLeft: [20, 20], paddingBottomRight: [16, box.offsetHeight + 16 + 28] };
  }

  // The theme changed: new tiles if they come in two flavours, new strokes.
  function setTheme() {
    if (cartoKey) tiles.setUrl(cartoUrl(cartoKey, theme()));
    styleAreas(lastView);
    spreadPicks();
  }

  return { render, fitData, focusWard, highlightPick, resetView, select, setLayer, setTheme, layer: () => mode };
}

function theme() {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// ---- What each layer paints, and says ----------------------------------

function fillFor(ward, view, mode, band) {
  const p = ward.properties;
  const fit = view.fit.get(p.name);
  switch (mode) {
    case "fit": {
      if (fit.out) return { fillColor: LEFT_OUT, fillOpacity: 0.4 };
      const index = fitBand(fit.score).index;
      return { fillColor: FIT[index], fillOpacity: band === null || band === index ? 0.84 : 0.12 };
    }
    case "competition": {
      const cls = p.categories[view.category].density_class;
      return { fillColor: DENSITY[cls], fillOpacity: view.picks.includes(ward) ? 0.8 : 0.6 };
    }
    case "rent":
      return { fillColor: RENT[TIERS.indexOf(p.rent.tier)], fillOpacity: 0.8 };
    case "confidence":
      return { fillColor: CONFIDENCE[confidence(p, view.meta).level], fillOpacity: 0.72 };
    default:
      return { fillColor: STANDING[quintile(p.components[mode])], fillOpacity: 0.8 };
  }
}

function quintile(value) {
  return Math.min(4, Math.floor(value * 5));
}

function tipText(ward, view, mode) {
  const p = ward.properties;
  const fit = view.fit.get(p.name);
  switch (mode) {
    case "fit": return fit.out ? `Left out: ${fit.out}` : `${Math.round(fit.score)} · ${fitBand(fit.score).label} · ${rupees(fit.rent)}/mo`;
    case "competition": return `${p.categories[view.category].per_10k.toFixed(2)} ${CATEGORIES[view.category].many} per 10,000 residents`;
    case "rent": return `${cap(p.rent.tier)} tier${p.rent.estimated ? " (zone estimate)" : ""} · ${rupees(fit.rent)}/mo`;
    case "confidence": return `${confidence(p, view.meta).level} confidence`;
    default: return `${LAYERS[mode].label}: ${standing(p.components[mode])}`;
  }
}

function tipHtml(ward, view, mode) {
  return `<strong>${escapeHtml(ward.properties.name)}</strong><span class="tip-fig">${escapeHtml(tipText(ward, view, mode))}</span>`;
}

// ---- Legend: what the colours mean, for whichever layer is on ----------

function legendHtml(view, mode, band, outletsOn) {
  const { meta, picks, category } = view;
  const keys = [];
  if (picks.length) keys.push(legendRow('<span class="swatch top-pick"></span>', "Your top 5"));
  if (mode === "fit") keys.push(legendRow(swatch(LEFT_OUT), "Left out by your brief"));
  keys.push(legendRow('<span class="swatch hatch"></span>', `Under ${meta.min_outlets} outlets: thin data`));
  const outlets = `<label class="legend-toggle"><input type="checkbox" data-toggle="outlets" ${outletsOn ? "checked" : ""}>
    Show mapped outlets</label>`;
  const rows = (items, clickable) => `<ul class="legend-bands">${items.map(({ colour, label, range, value }) => `<li>${clickable
    ? `<button type="button" class="band" data-band="${value}" aria-pressed="${band === value}">`
    : '<span class="band">'}${swatch(colour)}<span class="band-label">${label}</span><span class="band-range">${range ?? ""}</span>${clickable ? "</button>" : "</span>"}</li>`).join("")}</ul>`;
  let title;
  let sub;
  let body;
  if (mode === "fit") {
    title = "Fit score";
    sub = band === null ? "Click a band to show only those wards" : "Showing one band; click it again for all";
    body = rows(FIT_LABELS.map((label, i) => ({ colour: FIT[i], label, value: i,
      range: num(i === 0 ? `<${FIT_BREAKS[0]}` : i === FIT_LABELS.length - 1 ? `${FIT_BREAKS.at(-1)}+` : `${FIT_BREAKS[i - 1]}–${FIT_BREAKS[i] - 1}`) })).reverse(), true);
  } else if (mode === "competition") {
    const ranges = meta.density_ranges[category];
    const what = CATEGORIES[category].many;
    title = `${what[0].toUpperCase() + what.slice(1)} per 10k residents`;
    sub = "Mapped outlets; quintiles across wards";
    body = rows([5, 4, 3, 2, 1, 0].filter((c) => ranges[c]).map((c) => {
      const [low, high] = ranges[c];
      return { colour: DENSITY[c], label: c === 0 ? "None mapped" : num(low === high ? low : `${low}–${high}`) };
    }), false);
  } else if (mode === "rent") {
    title = "Rent tier";
    sub = "From published high-street rents; most wards take their zone's tier";
    body = rows([...TIERS].reverse().map((tier) => ({ colour: RENT[TIERS.indexOf(tier)], label: cap(tier) })), false);
  } else if (mode === "confidence") {
    title = "Data confidence";
    sub = "Outlet coverage, resident estimate and rent source";
    body = rows(Object.entries(CONFIDENCE).map(([label, colour]) => ({ colour, label })), false);
  } else {
    title = LAYERS[mode].label;
    sub = "Standing among Pune's 140 wards";
    body = rows([4, 3, 2, 1, 0].map((q) => ({ colour: STANDING[q], label: q === 4 ? "Top fifth" : q === 0 ? "Bottom fifth" : `Fifth ${5 - q}`,
      range: num(`${q * 20}–${q * 20 + 20}%`) })), false);
  }
  return `<p class="legend-title" title="${escapeHtml(sub)}">${title}</p>${body}
    <ul class="legend-keys">${keys.join("")}</ul>${outlets}`;
}

function swatch(color) {
  return `<span class="swatch" style="background:${color}"></span>`;
}

function legendRow(mark, label) {
  return `<li>${mark}<span>${label}</span></li>`;
}

function cap(text) {
  return text[0].toUpperCase() + text.slice(1);
}

// Leaflet draws every vector layer into one SVG, so the hatch pattern is
// defined once in that SVG and referenced as a fill.
function ensureHatchPattern(map) {
  const svg = map.getPanes().overlayPane.querySelector("svg");
  if (!svg || svg.querySelector("#hatch")) return;
  svg.insertAdjacentHTML("afterbegin", `
    <defs>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#1A1D21" stroke-width="0.9" stroke-opacity="0.18"></line>
      </pattern>
    </defs>`);
}

// ---- Basemap -----------------------------------------------------------

// CARTO's Positron and Dark Matter are muted enough for the data to read
// clearly, but need a (free) key. Without one, OpenStreetMap's tiles are
// greyscaled (and inverted at night) in CSS instead.
function cartoUrl(key, mode) {
  return `https://basemaps.cartocdn.com/rastertiles/${mode === "dark" ? "dark_all" : "light_all"}/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`;
}

function basemap(cartoKey, mode) {
  if (cartoKey) {
    return L.tileLayer(cartoUrl(cartoKey, mode),
      { attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>` });
  }
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: OSM_ATTRIBUTION });
}

// Bad wifi shouldn't sink a demo: if tiles fail more often than they load,
// switch to a flat background and say so once.
function watchTiles(map, tiles, element) {
  let loaded = 0;
  let failed = 0;
  let noticed = false;
  tiles.on("tileload", () => { loaded += 1; });
  tiles.on("tileerror", () => {
    failed += 1;
    if (noticed || failed <= loaded) return;
    noticed = true;
    element.classList.add("no-basemap");
    const notice = L.control({ position: "topright" });
    notice.onAdd = () => {
      const div = L.DomUtil.create("div", "basemap-notice");
      div.setAttribute("role", "status");
      div.innerHTML = `<span>Basemap unavailable. Areas, markers and scores still work.</span>
        <button type="button" aria-label="Dismiss">×</button>`;
      L.DomEvent.disableClickPropagation(div);
      div.querySelector("button").addEventListener("click", () => notice.remove());
      return div;
    };
    notice.addTo(map);
  });
}

function labelPoint(ward) {
  const [lng, lat] = ward.properties.label_point;
  return [lat, lng];
}

function latLng(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  return [lat, lng];
}
