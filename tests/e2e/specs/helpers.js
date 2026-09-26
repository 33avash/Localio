// Map tiles come from the internet and change over time, so tests that
// compare pixels block them and use the flat fallback background.
export async function blockTiles(page) {
  await page.route(/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/, (route) => route.abort());
}

export async function open(page, hash = "") {
  await page.goto(`/${hash}`);
  await page.locator("#panel-body h2").waitFor();
}

// Centres of the numbered markers, in screen pixels.
export async function markerCentres(page) {
  return page.locator(".pick-marker").evaluateAll((markers) => markers.map((marker) => {
    const box = marker.getBoundingClientRect();
    return [box.x + box.width / 2, box.y + box.height / 2];
  }));
}

export function closestPair(points) {
  let closest = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      closest = Math.min(closest, Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]));
    }
  }
  return closest;
}
