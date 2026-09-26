const PUNE = [18.5204, 73.8567];
const PUNE_BOUNDS = [[18.40, 73.65], [18.68, 73.98]];

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

export const COLORS = {
  cafe: "#4F79A8",
  fast_food: "#8466B0",
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
  // so nothing accumulates when the view changes.
  const outlets = L.layerGroup().addTo(map);

  function render({ pois }) {
    outlets.clearLayers();
    for (const poi of pois) {
      const color = COLORS[poi.properties.category];
      L.circleMarker(latLng(poi), {
        radius: 4,
        color: "#FFFFFF",
        weight: 1,
        fillColor: color,
        fillOpacity: 0.75,
      }).addTo(outlets);
    }
  }

  return { render };
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

function latLng(feature) {
  const [lng, lat] = feature.geometry.coordinates;
  return [lat, lng];
}
