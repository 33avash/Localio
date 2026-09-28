import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { blockTiles, closestPair, markerCentres, open } from "./helpers.js";

test("the map shows tiles, or the fallback notice when tiles fail", async ({ page }) => {
  await open(page);
  await expect(page.locator(".leaflet-tile-loaded, .basemap-notice").first()).toBeVisible({ timeout: 15_000 });
});

test("without tiles, the fallback notice appears and the areas still draw", async ({ page }) => {
  await blockTiles(page);
  await open(page);
  await expect(page.locator(".basemap-notice")).toBeVisible();
  await expect(page.locator(".leaflet-overlay-pane path.leaflet-interactive")).toHaveCount(51);
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
  for (const lens of ["Low competition", "Proven footfall", "Weak incumbents"]) {
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

test("a shortlist row opens the drawer with a recommendation", async ({ page }) => {
  await open(page, "#shortlist/qsr/footfall");
  const name = await page.locator(".pick-name").first().innerText();
  await page.locator(".pick").first().click();
  await expect(page.locator("#drawer-title")).toHaveText(name);
  await expect(page.locator(".verdict")).toHaveText(/\w{3,}/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).toBeHidden();
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
});

for (const [label, hash] of [["step 1", ""], ["shortlist", "#shortlist/cafe/footfall"], ["ask", "#ask/cafe/footfall"]]) {
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
