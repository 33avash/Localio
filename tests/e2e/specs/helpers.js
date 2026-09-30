// Map tiles come from the internet and change over time, so tests that
// compare pixels block them and use the flat fallback background.
export async function blockTiles(page) {
  await page.route(/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/, (route) => route.abort());
}

// Tests never call the real Gemini: by default the page gets no key (the
// built-in answers); pass { gemini } to answer Gemini's requests with a
// function of the request body instead.
export async function open(page, hash = "", { gemini } = {}) {
  await page.route("**/config.json", (route) =>
    route.fulfill({ json: { cartoKey: "", geminiKey: gemini ? "test-key" : "" } }));
  if (gemini) {
    await page.route("https://generativelanguage.googleapis.com/**", async (route) => {
      const reply = await gemini(route.request().postDataJSON());
      if (reply.status) return route.fulfill({ status: reply.status, json: {} });
      return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(reply) }] } }] } });
    });
  }
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
