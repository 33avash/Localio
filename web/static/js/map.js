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

const SATURATION = {
  none: "#6B6E73",
  low: "#A8C3B8",
  medium: "#E0B15C",
  high: "#C9604A",
};

export function createMap(element, { cartoKey }) {
  const map = L.map(element, {
    center: PUNE,
    zoom: 12,
    minZoom: 10,
    maxZoom: 16,
    maxBounds: PUNE_BOUNDS,
    maxBoundsViscosity: 1,
  });
  basemap(cartoKey).addTo(map);
  element.classList.toggle("basemap-osm", !cartoKey);

  // Markers only ever go into named groups, cleared on every render,
  // so nothing accumulates across steps.
  const outlets = L.layerGroup().addTo(map);
  const areas = L.layerGroup().addTo(map);

  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => L.DomUtil.create("div", "legend");
  legend.addTo(map);

  function render(view) {
    map.closePopup();
    outlets.clearLayers();
    areas.clearLayers();
    if (view.step === 1) drawOutlets(view);
    else drawAreas(view);
    legend.getContainer().innerHTML = view.step === 1 ? outletLegend(view) : areaLegend(view);
  }

  // Step 1: every POI. Once a format is picked, the other one fades to grey
  // but stays visible, because where people already eat is the point.
  function drawOutlets({ pois, category }) {
    const ordered = [...pois].sort((a, b) => (a.properties.category === category) - (b.properties.category === category));
    for (const poi of ordered) {
      const faded = category && poi.properties.category !== category;
      L.circleMarker(latLng(poi), {
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

  // Steps 2-3: one bubble per locality, sized by how many of the chosen
  // format it has and coloured by saturation. Dashed means too few to score.
  function drawAreas(view) {
    const { localities, category, picks } = view;
    const bySize = [...localities].sort((a, b) => count(b, category) - count(a, category));
    for (const locality of bySize) {
      const dimmed = picks.length > 0 && !picks.includes(locality);
      const color = SATURATION[locality.properties.categories[category].saturation];
      L.circleMarker(latLng(locality), {
        radius: 6 + Math.sqrt(count(locality, category)) * 4.5,
        color,
        weight: 1.5,
        opacity: dimmed ? 0.2 : 1,
        fillColor: color,
        fillOpacity: dimmed ? 0.1 : 0.5,
        dashArray: locality.properties.status === "scored" ? null : "3 3",
      })
        .bindPopup(() => localityPopup(locality.properties, view), POPUP)
        .addTo(areas);
    }
  }

  return { render };
}

const POPUP = { className: "localio-popup", minWidth: 230, maxWidth: 280 };

function outletLegend({ category }) {
  const rows = Object.keys(CATEGORIES).map((key) => {
    const faded = category && key !== category;
    return legendRow(`<span class="swatch dot" style="background:${faded ? COLORS.other : COLORS[key]}"></span>`,
      CATEGORIES[key].label);
  });
  return `<p class="legend-title">Outlets</p><ul>${rows.join("")}</ul>`;
}

function areaLegend({ category, meta }) {
  const ranges = meta.saturation_ranges[category];
  const tiers = ["high", "medium", "low"].map((tier) => {
    const [low, high] = ranges[tier];
    return legendRow(swatch(SATURATION[tier]), tier[0].toUpperCase() + tier.slice(1), num(low === high ? low : `${low}–${high}`));
  });
  const rows = [
    ...tiers,
    legendRow(swatch(SATURATION.none), "None", num(0)),
    legendRow('<span class="swatch dashed"></span>', `Under ${num(meta.min_pois_to_score)} outlets, not scored`),
  ];
  return `<p class="legend-title">${CATEGORIES[category].many} per locality</p><ul>${rows.join("")}</ul>`;
}

function swatch(color) {
  return `<span class="swatch" style="background:${color}80; border-color:${color}"></span>`;
}

function legendRow(mark, label, value = "") {
  return `<li>${mark}<span>${label}</span><span class="legend-value">${value}</span></li>`;
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

function count(locality, category) {
  return locality.properties.categories[category].count;
}

function latLng(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  return [lat, lng];
}
