// Copies the Leaflet, IBM Plex and Instrument Serif files the site needs from node_modules
// into static/vendor/. Run after `npm install` when bumping a version; the
// copied files are committed so the build never depends on a CDN.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const modules = join(web, "node_modules");
const vendor = join(web, "static", "vendor");

const files = {
  "leaflet/leaflet.js": "leaflet/dist/leaflet.js",
  "leaflet/leaflet.css": "leaflet/dist/leaflet.css",
  "leaflet/images": "leaflet/dist/images",
  "leaflet/LICENSE": "leaflet/LICENSE",
  "fonts/LICENSE": "@fontsource/ibm-plex-sans/LICENSE",
  "fonts/LICENSE-instrument-serif": "@fontsource/instrument-serif/LICENSE",
  "fonts/instrument-serif-400.woff2": "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2",
  "fonts/instrument-serif-400-italic.woff2": "@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2",
};
for (const weight of [400, 500, 600]) {
  files[`fonts/ibm-plex-sans-${weight}.woff2`] = `@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff2`;
}
for (const weight of [400, 500]) {
  files[`fonts/ibm-plex-mono-${weight}.woff2`] = `@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-${weight}-normal.woff2`;
}

rmSync(vendor, { recursive: true, force: true });
for (const [target, source] of Object.entries(files)) {
  const destination = join(vendor, target);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(modules, source), destination, { recursive: true });
  console.log(`vendored ${target}`);
}
