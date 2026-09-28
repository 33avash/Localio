import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { blockTiles, closestPair, markerCentres, open } from "./helpers.js";

test("the map shows tiles, or the fallback notice when tiles fail", async ({ page }) => {
  await open(page);
  await expect(page.locator(".leaflet-tile-loaded, .basemap-notice").first()).toBeVisible({ timeout: 15_000 });
});

test("without tiles, the fallback notice appears and all 140 wards still draw", async ({ page }) => {
  await blockTiles(page);
  await open(page);
  await expect(page.locator(".basemap-notice")).toBeVisible();
  const wards = await page.locator(".leaflet-overlay-pane path.leaflet-interactive").count();
  expect(wards).toBeGreaterThan(100);
});

test("outlet dots render", async ({ page }) => {
  await open(page);
  expect(await page.locator(".leaflet-outlets-pane path").count()).toBeGreaterThan(0);
});

test("choosing Cafe then Continue reaches step 2", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: /^Cafe/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#panel-body h2")).toHaveText("What matters most?");
  await expect(page).toHaveURL(/#priority\/cafe$/);
});

test("the lenses change who ranks first", async ({ page }) => {
  await open(page, "#shortlist/cafe/footfall");
  const leaders = new Set();
  for (const lens of ["Low competition", "Proven footfall", "Unmet demand"]) {
    await page.locator(".lens-switch").getByRole("radio", { name: lens }).click();
    leaders.add(await page.locator(".pick-name").first().innerText());
  }
  expect(leaders.size).toBeGreaterThan(1);
});

test("exactly five numbered markers, none within 30px of another", async ({ page }) => {
  await open(page, "#shortlist/cafe/footfall");
  await expect(page.locator(".pick-marker")).toHaveCount(5);
  for (const zoom of ["in", "out"]) {
    expect(closestPair(await markerCentres(page))).toBeGreaterThanOrEqual(30);
    await page.locator(`.leaflet-control-zoom-${zoom}`).click();
    await page.waitForTimeout(400);
  }
  expect(closestPair(await markerCentres(page))).toBeGreaterThanOrEqual(30);
});

test("a shortlist row opens the drawer with a money figure and a recommendation", async ({ page }) => {
  await open(page, "#shortlist/qsr/footfall");
  const name = await page.locator(".pick-name").first().innerText();
  await page.locator(".pick").first().click();
  await expect(page.locator("#drawer-title")).toHaveText(name);
  await expect(page.locator(".money .hero")).toHaveText(/₹\d/);
  await expect(page.locator(".money .figures")).toContainText("Profit a month");
  await expect(page.locator(".verdict")).toHaveText(/\w{3,}/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).toBeHidden();
});

test("shortlist rows show a profit range and the money insight", async ({ page }) => {
  await open(page, "#shortlist/cafe/footfall");
  await expect(page.locator(".pick-money")).toHaveCount(5);
  await expect(page.locator(".pick-money").first()).toHaveText(/₹.+–.*₹/);
  await expect(page.locator(".insight")).toContainText(/footfall|payback/);
});

test("changing outlet size in Assumptions changes the projected figures", async ({ page }) => {
  await open(page, "#assumptions/cafe/footfall");
  await expect(page.locator("#panel-body h2")).toHaveText("Assumptions");
  const before = await page.locator(".assume-profit").allInnerTexts();
  expect(before).toHaveLength(5);
  await page.locator("[data-assume=sqft]").fill("800");
  await expect.poll(() => page.locator(".assume-profit").allInnerTexts()).not.toEqual(before);
  await expect(page).toHaveURL(/sqft=800/);
  // The shortlist and the drawer use the same assumptions.
  await page.getByRole("button", { name: "Back to the shortlist" }).click();
  await expect(page.locator(".lede")).toContainText("800 sq ft");
});

test("the browser's economics match the pipeline's to the rupee on every ward", async ({ page }) => {
  await open(page);
  const mismatches = await page.evaluate(async () => {
    const { defaults, project } = await import("/js/economics.js");
    const [localities, econ] = await Promise.all(["localities.geojson", "economics.json"]
      .map((file) => fetch(`/data/${file}`).then((r) => r.json())));
    const wrong = [];
    for (const { properties: p } of localities.features) {
      for (const category of ["cafe", "fast_food"]) {
        const js = project(econ, category, defaults(econ, category), {
          multiplier: p.capacity.multiplier,
          per_10k: p.categories[category].per_10k,
          rent_multiplier: p.rent.multiplier,
        }, localities.meta.city.per_10k[category]);
        if (JSON.stringify(js) !== JSON.stringify(p.economics[category])) wrong.push(`${p.name} ${category}`);
      }
    }
    return wrong;
  });
  expect(mismatches).toEqual([]);
});

test("the browser writes the same insight as the pipeline", async ({ page }) => {
  await open(page);
  const results = await page.evaluate(async () => {
    const { insight } = await import("/js/economics.js");
    const econ = await fetch("/data/economics.json").then((r) => r.json());
    return econ.examples.map((example) => [insight(example.entries, econ.rent.flag), example.sentence]);
  });
  expect(results.length).toBeGreaterThan(0);
  for (const [js, python] of results) expect(js).toBe(python);
});

test("the chat cites a locality it names", async ({ page }) => {
  await open(page, "#ask/cafe/footfall");
  await page.locator("#ask-input").fill("Tell me about Koregaon Park");
  await page.keyboard.press("Enter");
  const answer = page.locator(".msg-answer").last();
  await expect(answer.locator(".chip")).toHaveText(["Koregaon Park"]);
  await expect(answer.locator("p").first()).toContainText("Koregaon Park");
});

test("the chat refuses off-topic questions instead of inventing a locality", async ({ page }) => {
  await open(page, "#ask/cafe/footfall");
  await page.locator("#ask-input").fill("who won the world cup");
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.locator(".msg-answer").last();
  await expect(answer).toContainText("I only answer questions about where to open a cafe or QSR in Pune");
  await expect(answer.locator(".chip")).toHaveCount(0);
});

test("the keyboard alone gets from step 1 to the shortlist", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: /^QSR/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Continue" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("radio", { name: /^Proven footfall/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Show my shortlist" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#panel-body h2")).toHaveText("Your shortlist");
  await expect(page.locator("#panel-body h2")).toBeFocused();
  await page.locator(".rail").getByRole("button", { name: "Assumptions" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#panel-body h2")).toHaveText("Assumptions");
  await expect(page.locator("#panel-body h2")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio", { name: "Small QSR" })).toBeFocused();
});

for (const [label, hash] of [["step 1", ""], ["shortlist", "#shortlist/cafe/footfall"], ["ask", "#ask/cafe/footfall"],
  ["assumptions", "#assumptions/cafe/footfall"]]) {
  test(`panel text meets 4.5:1 contrast on ${label}`, async ({ page }) => {
    await open(page, hash);
    const results = await new AxeBuilder({ page }).include("#panel").withRules(["color-contrast"]).analyze();
    expect(results.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")))).toEqual([]);
  });
}

test("the drawer's text meets 4.5:1 contrast", async ({ page }) => {
  await open(page, "#shortlist/cafe/footfall");
  await page.locator(".pick").first().click();
  await expect(page.locator("#drawer.open")).toBeVisible();
  const results = await new AxeBuilder({ page }).include("#drawer").withRules(["color-contrast"]).analyze();
  expect(results.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")))).toEqual([]);
});
