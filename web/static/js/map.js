import { CATEGORIES, num } from "./format.js";
import { localityPopup, outletPopup } from "./popups.js";

const PUNE = [18.5204, 73.8567];
const PUNE_BOUNDS = [[18.40, 73.65], [18.68, 73.98]];

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

export function createMap(element, { cartoKey }) {
  const map = L.map(element, {
    center: PUNE,
    zoom: 12,
    minZoom: 10,
    maxZoom: 16,
    maxBounds: PUNE_BOUNDS,
    maxBoundsViscosity: 1,
  });
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
  let pickMarkers = [];
  let lastView = null;
  let outletsChoice = null;

  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => {
    const div = L.DomUtil.create("div", "legend");
    L.DomEvent.disableClickPropagation(div);
    div.addEventListener("change", (event) => {
      if (!event.target.matches("[data-toggle=outlets]")) return;
      outletsChoice = event.target.checked;
      drawOutlets(lastView);
    });
    return div;
  };
  legend.addTo(map);

  function render(view) {
    lastView = view;
    map.closePopup();
    areas.clearLayers();
    hatching.clearLayers();
    picks.clearLayers();
    pickMarkers = [];
    drawAreas(view);
    drawOutlets(view);
    if (view.step === 3) drawPicks(view);
    legend.getContainer().innerHTML = legendHtml(view, showOutlets(view));
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
  // too few outlets to score get a hatch on top.
  function drawAreas(view) {
    const shortlisted = view.step === 3;
    for (const locality of view.localities) {
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
        layer.bindPopup(() => localityPopup(locality.properties, view), POPUP);
        layer.on("mouseover", () => layer.setStyle({ color: ACCENT, opacity: 1, weight: 2 }).bringToFront());
        layer.on("mouseout", () => area.resetStyle(layer));
      });
      area.addTo(areas);
      if (locality.properties.status !== "scored") {
        L.geoJSON(locality, { interactive: false, style: { stroke: false, fillColor: "url(#hatch)", fillOpacity: 1 } })
          .addTo(hatching);
      }
    }
    ensureHatchPattern(map);
  }

  // The top 5 are the one loud element on the map.
  function drawPicks(view) {
    pickMarkers = view.picks.map((locality, i) =>
      L.marker(labelPoint(locality), {
        icon: L.divIcon({ className: "pick-marker", html: num(i + 1), iconSize: [28, 28] }),
        title: `${i + 1}. ${locality.properties.name}`,
        zIndexOffset: 1000,
      })
        .bindPopup(() => localityPopup(locality.properties, view), POPUP)
        .addTo(picks));
  }

  function focusPick(index) {
    const marker = pickMarkers[index];
    map.once("moveend", () => marker.openPopup());
    map.flyTo(marker.getLatLng(), 14, { duration: 1.2 });
  }

  function resetView() {
    map.setView(PUNE, 12);
  }

  return { render, focusPick, resetView };
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

function legendHtml(view, outletsOn) {
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
    legendRow('<span class="swatch hatch"></span>', `Under ${num(meta.min_pois_to_score)} outlets, not scored`),
  ];
  const what = category ? CATEGORIES[category].many : "cafes and QSRs";
  return `
    <p class="legend-title">${what[0].toUpperCase() + what.slice(1)} per 10,000 residents</p>
    <ul>${rows.join("")}</ul>
    <label class="legend-toggle"><input type="checkbox" data-toggle="outlets" ${outletsOn ? "checked" : ""}>
      Show outlets</label>`;
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
      div.textContent = "Basemap unavailable. Markers and scores still work.";
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
