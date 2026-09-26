import { createMap } from "./map.js";

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

// The key is optional, so a missing config just means OpenStreetMap tiles.
const config = await getJson("config.json").catch(() => ({}));
const map = createMap(document.getElementById("map"), { cartoKey: config.cartoKey });

const pois = await getJson("data/pois.geojson");
map.render({ pois: pois.features });
