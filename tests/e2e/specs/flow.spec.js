import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { blockTiles, closestPair, markerCentres, open } from "./helpers.js";

const rows = (page) => page.locator(".pick");
const names = (page) => page.locator(".pick-name").allInnerTexts();
const rupees = (text) => {
  const [, value, unit] = text.match(/₹([\d.]+)(k|L)?/);
  return Number(value) * (unit === "k" ? 1e3 : unit === "L" ? 1e5 : 1);
};

test("the map shows tiles, or the fallback notice when tiles fail", async ({ page }) => {
  await open(page);
  await expect(page.locator(".leaflet-tile-loaded, .basemap-notice").first()).toBeVisible({ timeout: 15_000 });
});

test("without tiles, the fallback notice appears and all 140 wards still draw", async ({ page }) => {
  await blockTiles(page);
  await open(page);
  await expect(page.locator(".basemap-notice")).toBeVisible();
  expect(await page.locator(".leaflet-overlay-pane path.leaflet-interactive").count()).toBeGreaterThan(100);
});

test("the top 5 appear straight away, as five markers none within 30px", async ({ page }) => {
  await open(page);
  await expect(rows(page)).toHaveCount(5);
  await expect(page.locator(".pick-marker")).toHaveCount(5);
  for (const zoom of ["in", "out"]) {
    expect(closestPair(await markerCentres(page))).toBeGreaterThanOrEqual(30);
    await page.locator(`.leaflet-control-zoom-${zoom}`).click();
    await page.waitForTimeout(400);
  }
  expect(closestPair(await markerCentres(page))).toBeGreaterThanOrEqual(30);
});

test("each score is its busyness plus its room", async ({ page }) => {
  await open(page);
  for (const row of await rows(page).all()) {
    const [busy, room] = (await row.locator(".pick-why .num").allInnerTexts()).slice(0, 2).map(Number);
    const score = Number(await row.locator(".pick-score").innerText());
    expect(Math.abs(busy + room - score)).toBeLessThanOrEqual(1);
  }
});

test("the priority changes who ranks first", async ({ page }) => {
  await open(page);
  const leaders = new Set();
  for (const priority of ["Busy areas", "Balanced", "Low competition"]) {
    await page.getByRole("radio", { name: priority }).click();
    leaders.add((await names(page))[0]);
  }
  expect(leaders.size).toBeGreaterThan(1);
});

test("the area limits the list to that corporation", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "Pimpri-Chinchwad" }).click();
  for (const name of await names(page)) expect(name).toContain("PCMC");
  await expect(page).toHaveURL(/#cafe\/balanced\/pcmc/);
});

test("the rent budget filters the list, and an empty list offers a fix", async ({ page }) => {
  await open(page);
  await page.locator("#budget").fill("26000");
  for (const text of await page.locator(".pick-why").allInnerTexts()) expect(rupees(text.split("·").at(-1))).toBeLessThanOrEqual(26000);
  await expect(page).toHaveURL(/budget=26000/);
  await page.locator("#budget").fill("5000");
  await expect(page.locator(".empty")).toContainText("No ward's rent fits");
  await page.locator(".empty button").click();
  await expect(rows(page).first()).toBeVisible();
});

test("the shop size changes the rent", async ({ page }) => {
  await open(page);
  const before = await page.locator(".pick-why").allInnerTexts();
  await page.locator("#sqft").fill("900");
  await expect.poll(() => page.locator(".pick-why").allInnerTexts()).not.toEqual(before);
  await expect(page).toHaveURL(/sqft=900/);
});

test("the URL brings a plan back exactly", async ({ page }) => {
  await open(page, "#qsr/busy/pcmc?sqft=450&budget=40000");
  for (const name of ["QSR", "Busy areas", "Pimpri-Chinchwad"]) {
    await expect(page.getByRole("radio", { name, exact: true })).toHaveAttribute("aria-checked", "true");
  }
  await expect(page.locator("#sqft")).toHaveValue("450");
  await expect(page.locator("#budget")).toHaveValue("40000");
});

test("a row opens the drawer with its score, rent and recommendation", async ({ page }) => {
  await open(page);
  const name = (await names(page))[0];
  await rows(page).first().click();
  await expect(page.locator("#drawer-title")).toHaveText(name);
  await expect(page.locator(".stat").first()).toContainText("/100");
  await expect(page.locator(".stat").nth(1)).toContainText(/₹\d/);
  await expect(page.locator(".verdict")).toHaveText(/\w{3,}/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#drawer")).toBeHidden();
});

test("the drawer hands a ward to the chat", async ({ page }) => {
  await open(page);
  const name = (await names(page))[0];
  await rows(page).first().click();
  await page.locator("[data-action=ask-ward]").click();
  await expect(page.getByRole("tab", { name: "Ask" })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".msg-answer").last().locator(".chip")).toHaveText([name]);
});

test("the chat's top 5 matches the shortlist", async ({ page }) => {
  await open(page, "#qsr/quiet/all");
  const shortlist = await names(page);
  await page.getByRole("tab", { name: "Ask" }).click();
  await page.locator("#ask-input").fill("Where should I open a QSR?");
  await page.keyboard.press("Enter");
  await expect(page.locator(".msg-answer").last().locator(".chip")).toHaveText(shortlist.map((n) => n.replace(" few outlets", "")));
});

test("a chat answer can set the plan on the map", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Ask" }).click();
  await page.locator("#ask-input").fill("Cafes in PCMC under ₹30k rent");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Use this plan on the map" }).click();
  await expect(page.getByRole("radio", { name: "Pimpri-Chinchwad" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#budget")).toHaveValue("30000");
});

test("a chat chip opens that ward's drawer", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Ask" }).click();
  await page.locator("#ask-input").fill("Tell me about Koregaon Park");
  await page.keyboard.press("Enter");
  const answer = page.locator(".msg-answer").last();
  await expect(answer).toContainText("Koregaon Park (PMC ward 21)");
  await answer.locator(".chip").click();
  await expect(page.locator("#drawer-title")).toHaveText("Koregaon Park");
});

test("the chat refuses off-topic questions instead of inventing a ward", async ({ page }) => {
  await open(page);
  await page.getByRole("tab", { name: "Ask" }).click();
  await page.locator("#ask-input").fill("who won the world cup");
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.locator(".msg-answer").last();
  await expect(answer).toContainText("I only answer questions about opening a cafe or QSR in Pune");
  await expect(answer.locator(".chip")).toHaveCount(0);
});

test("the keyboard alone changes the plan and switches tabs", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "QSR" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "QSR" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("radio", { name: "QSR" })).toBeFocused();
  await page.getByRole("tab", { name: "Plan" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Ask" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Ask" })).toHaveAttribute("aria-selected", "true");
});

for (const [label, setup] of [["plan", async () => {}], ["ask", async (page) => page.getByRole("tab", { name: "Ask" }).click()]]) {
  test(`panel text meets 4.5:1 contrast on ${label}`, async ({ page }) => {
    await open(page);
    await setup(page);
    const results = await new AxeBuilder({ page }).include("#panel").withRules(["color-contrast"]).analyze();
    expect(results.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")))).toEqual([]);
  });
}

test("the drawer's text meets 4.5:1 contrast", async ({ page }) => {
  await open(page);
  await rows(page).first().click();
  await expect(page.locator("#drawer.open")).toBeVisible();
  const results = await new AxeBuilder({ page }).include("#drawer").withRules(["color-contrast"]).analyze();
  expect(results.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")))).toEqual([]);
});
