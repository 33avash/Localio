import { CATEGORIES, escapeHtml, num } from "./format.js";
import { reducedMotion } from "./motion.js";
import { outletPopup } from "./popups.js";

// Only a starting point while data loads; fitData() then frames the catchments.
const PUNE = [18.5204, 73.8567];

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const COLORS = {
  cafe: "#4F79A8",
  fast_food: "#8466B0",
  other: "#6B6E73",
};

// Outlets per 10,000 residents, five quantile classes in a warm ramp kept
// well away from the teal accent, so "crowded" never reads as "recommended".
// Class 0 (none yet) is a neutral grey rather than the bottom of the ramp.
const DENSITY = ["#D6D4CF", "#F6E4C1", "#EDC486", "#E09A55", "#C66A34", "#8F4322"];
const ACCENT = "#3D8F7B";

const POPUP = { className: "localio-popup", minWidth: 240, maxWidth: 290 };

// Numbered markers closer than this on screen get pushed apart.
const MIN_GAP_PX = 34;

// onSelect(name) runs when an area or a numbered marker is clicked.
export function createMap(element, { cartoKey, onSelect }) {
  const map = L.map(element, {
    center: PUNE,
    zoom: 12,
    maxZoom: 16,
    maxBoundsViscosity: 0.8,
    // Quarter steps let fitData() frame the catchments closely on any
    // screen instead of dropping a whole zoom level to make them fit.
    zoomSnap: 0.25,
  });
  let dataBounds = null;
  const tiles = basemap(cartoKey).addTo(map);
  element.classList.toggle("basemap-osm", !cartoKey);
  watchTiles(map, tiles, element);

  // Leaflet measures its container once. Any later size change (the phone
  // sheet moving, crossing the breakpoint) needs a re-measure, or tiles stop
  // short and clicks land in the wrong place.
  new ResizeObserver(() => map.invalidateSize()).observe(element);

  // Outlet dots get their own pane above the areas, so a hovered area
  // brought to the front never covers them.
  map.createPane("outlets").style.zIndex = 450;

  // Markers only ever go into named groups, cleared on every render,
  // so nothing accumulates across steps.
  const areas = L.layerGroup().addTo(map);
  const hatching = L.layerGroup().addTo(map);
  const outlets = L.layerGroup().addTo(map);
  const picks = L.layerGroup().addTo(map);
  const leaders = L.layerGroup().addTo(map);
  let pickMarkers = [];
  let areaLayers = new Map();
  let selected = null;
  let lastView = null;
  let outletsChoice = null;
  // On a phone the legend would cover a third of the map, so it starts
  // folded down to its title there. Whatever the user picks then sticks.
  let legendOpen = !window.matchMedia("(max-width: 859px)").matches;

  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    L.DomEvent.disableClickPropagation(div);
    div.addEventListener("change", (event) => {
      if (!event.target.matches("[data-toggle=outlets]")) return;
      outletsChoice = event.target.checked;
      drawOutlets(lastView);
    });
    div.addEventListener("toggle", (event) => { legendOpen = event.target.open; }, true);
    return div;
  };
  legend.addTo(map);

  function render(view) {
    lastView = view;
    map.closePopup();
    areas.clearLayers();
    hatching.clearLayers();
    picks.clearLayers();
    leaders.clearLayers();
    pickMarkers = [];
    areaLayers = new Map();
    drawAreas(view);
    drawOutlets(view);
    if (view.step >= 3) drawPicks(view);
    legend.getContainer().innerHTML = legendHtml(view, showOutlets(view), legendOpen);
  }

  // Dots are on by default while choosing a format and off after that,
  // unless the legend checkbox says otherwise.
  function showOutlets(view) {
    return outletsChoice ?? view.step === 1;
  }

  // Once a format is picked, the other one fades to grey but stays visible,
  // because where people already eat is the point.
  function drawOutlets(view) {
    outlets.clearLayers();
    if (!showOutlets(view)) return;
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
        fillOpacity: faded ? 0.15 : 0.75,
      })
        .bindPopup(() => outletPopup(poi.properties), POPUP)
        .addTo(outlets);
    }
  }

  // One filled catchment per locality. The areas tile rather than overlap,
  // so every colour on the map is a colour in the legend. Localities with
  // too few outlets for a confident score get a hatch on top. Hovering
  // shows the name and headline figure; clicking opens the detail drawer.
  function drawAreas(view) {
    const shortlisted = view.step >= 3;
    for (const locality of view.localities) {
      const { name } = locality.properties;
      const dimmed = shortlisted && !view.picks.includes(locality);
      const area = L.geoJSON(locality, {
        style: {
          color: "#FFFFFF",
          opacity: 0.25,
          weight: 0.5,
          fillColor: DENSITY[densityClass(locality, view.category)],
          fillOpacity: dimmed ? 0.2 : 0.7,
        },
      });
      area.eachLayer((layer) => {
        layer.bindTooltip(() => areaLabel(locality, view.category), { sticky: true, direction: "top", className: "area-tip", opacity: 1 });
        layer.on("mouseover", () => layer.setStyle(HIGHLIGHT).bringToFront());
        layer.on("mouseout", () => { if (name !== selected) area.resetStyle(layer); });
        layer.on("click", () => onSelect(name));
        layer.on("add", () => layer.getElement()?.setAttribute("aria-label", `${name}: ${plainLabel(locality, view.category)}`));
        areaLayers.set(name, { area, layer });
      });
      area.addTo(areas);
      if (locality.properties.status !== "scored") {
        L.geoJSON(locality, { interactive: false, style: { stroke: false, fillColor: "url(#hatch)", fillOpacity: 1 } })
          .addTo(hatching);
      }
    }
    ensureHatchPattern(map);
    if (selected) select(selected);
  }

  // Keep the open drawer's area outlined in the accent.
  function select(name) {
    if (selected && areaLayers.has(selected)) {
      const { area, layer } = areaLayers.get(selected);
      area.resetStyle(layer);
    }
    selected = name;
    if (name && areaLayers.has(name)) areaLayers.get(name).layer.setStyle(HIGHLIGHT).bringToFront();
  }

  function focusLocality(name) {
    const locality = lastView.localities.find((f) => f.properties.name === name);
    if (!locality) return;
    if (reducedMotion()) map.setView(labelPoint(locality), 14, { animate: false });
    else map.flyTo(labelPoint(locality), 14, { duration: 1.2 });
  }

  // The top 5 are the one loud element on the map. Each sits on its
  // catchment's label point, which is always inside the catchment.
  function drawPicks(view) {
    pickMarkers = view.picks.map((locality, i) => {
      const marker = L.marker(labelPoint(locality), {
        icon: L.divIcon({ className: "pick-marker", html: `<span class="pick-dot">${num(i + 1)}</span>`, iconSize: [28, 28] }),
        title: `${i + 1}. ${locality.properties.name}`,
        zIndexOffset: 1000,
      })
        .on("click", () => onSelect(locality.properties.name))
        .addTo(picks);
      marker.anchor = marker.getLatLng();
      return marker;
    });
    spreadPicks();
  }

  // Nearby picks (Deccan Gymkhana, Shivajinagar, Sadashiv Peth) would sit on
  // top of each other when zoomed out. Push any pair closer than MIN_GAP_PX
  // apart on screen and draw a thin line back to where each really is.
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
    pickMarkers.forEach((marker, i) => {
      const shown = map.containerPointToLatLng(points[i]);
      marker.setLatLng(shown);
      if (map.latLngToContainerPoint(marker.anchor).distanceTo(points[i]) < 2) return;
      L.polyline([marker.anchor, shown], { color: "#1A1D21", weight: 1, opacity: 0.7, interactive: false }).addTo(leaders);
      L.circleMarker(marker.anchor, { radius: 2, stroke: false, fillColor: "#1A1D21", fillOpacity: 0.8, interactive: false })
        .addTo(leaders);
    });
  }
  map.on("zoomend", spreadPicks);

  // Hovering or focusing a shortlist row lifts its marker above the others
  // and enlarges it, so the one being read is always findable.
  function highlightPick(index, on) {
    const marker = pickMarkers[index];
    if (!marker) return;
    marker.setZIndexOffset(on ? 2000 : 1000);
    marker.getElement()?.classList.toggle("is-highlighted", on);
  }

  // Frame the catchments instead of a fixed centre, which showed mostly
  // empty terrain. Panning stops a little past the data, and zooming out
  // stops one level past the framed view.
  function fitData(localities) {
    map.invalidateSize();
    dataBounds = L.geoJSON({ type: "FeatureCollection", features: localities }).getBounds();
    map.fitBounds(dataBounds, { padding: [40, 40], maxZoom: 13, animate: false });
    map.setMaxBounds(dataBounds.pad(0.15));
    map.setMinZoom(map.getZoom() - 1);
  }

  function resetView() {
    map.fitBounds(dataBounds, { padding: [40, 40], maxZoom: 13 });
  }

  return { render, fitData, focusLocality, highlightPick, resetView, select };
}

const HIGHLIGHT = { color: ACCENT, opacity: 1, weight: 2 };

function areaLabel(locality, category) {
  return `<strong>${escapeHtml(locality.properties.name)}</strong><br>${plainLabel(locality, category)}`;
}

function plainLabel(locality, category) {
  const p = locality.properties;
  const value = category ? p.categories[category].per_10k : p.total_per_10k;
  const what = category ? CATEGORIES[category].many : "cafes and QSRs";
  return `${value.toFixed(2)} ${what} per 10,000 residents`;
}

function densityClass(locality, category) {
  const { properties } = locality;
  return category ? properties.categories[category].density_class : properties.total_density_class;
}

// Leaflet draws every vector layer into one SVG, so the hatch pattern is
// defined once in that SVG and referenced as a fill.
function ensureHatchPattern(map) {
  const svg = map.getPanes().overlayPane.querySelector("svg");
  if (!svg || svg.querySelector("#hatch")) return;
  svg.insertAdjacentHTML("afterbegin", `
    <defs>
      <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="6" stroke="#4A4F57" stroke-width="1.2" stroke-opacity="0.55"></line>
      </pattern>
    </defs>`);
}

function legendHtml(view, outletsOn, open) {
  const { category, meta, picks } = view;
  const ranges = meta.density_ranges[category ?? "total"];
  const classes = [5, 4, 3, 2, 1].filter((c) => ranges[c]).map((c) => {
    const [low, high] = ranges[c];
    return legendRow(swatch(DENSITY[c]), num(low === high ? low : `${low}–${high}`));
  });
  const rows = [
    ...(picks.length ? [legendRow('<span class="swatch top-pick"></span>', "Your top 5")] : []),
    ...classes,
    ...(ranges[0] ? [legendRow(swatch(DENSITY[0]), "None yet")] : []),
    legendRow('<span class="swatch hatch"></span>', `Under ${num(meta.min_pois_to_score)} outlets, low confidence`),
  ];
  const what = category ? CATEGORIES[category].many : "cafes and QSRs";
  return `
    <details ${open ? "open" : ""}>
      <summary class="legend-title">${what[0].toUpperCase() + what.slice(1)} per 10,000 residents</summary>
      <ul>${rows.join("")}</ul>
      <label class="legend-toggle"><input type="checkbox" data-toggle="outlets" ${outletsOn ? "checked" : ""}>
        Show outlets</label>
    </details>`;
}

function swatch(color) {
  return `<span class="swatch" style="background:${color}"></span>`;
}

function legendRow(mark, label) {
  return `<li>${mark}<span>${label}</span></li>`;
}

// CARTO Positron is muted enough for the data to read clearly, but since
// September 2026 it needs a (free) key. Without one, CARTO answers with
// placeholder images rather than errors, so we switch to OpenStreetMap
// tiles instead and greyscale them in CSS.
function basemap(cartoKey) {
  if (cartoKey) {
    return L.tileLayer(
      `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(cartoKey)}`,
      { attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>` },
    );
  }
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: OSM_ATTRIBUTION });
}

// Bad wifi shouldn't sink the demo: if tiles fail more often than they load,
// switch to a flat background and say so once. Markers and the whole flow
// work without a basemap.
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

function labelPoint(locality) {
  const [lng, lat] = locality.properties.label_point;
  return [lat, lng];
}

function latLng(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  return [lat, lng];
}
