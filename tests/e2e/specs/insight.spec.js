// The analysis on top of the score: confidence, fit labels, sensitivity,
// what changed, market figures, provenance, export, the command palette,
// map layers and the theme. Every figure is checked against the data or
// against score.js, never against a number typed into the test.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { open } from "./helpers.js";

const BRIEF = "#cafe?for=offices&competition=avoid&budget=35000";

test("confidence comes from three signals in the data", async ({ page }) => {
  await open(page);
  const counts = await page.evaluate(async () => {
    const { confidence } = await import("/js/insight.js");
    const doc = await fetch("/data/wards.geojson").then((r) => r.json());
    const tally = { High: 0, Medium: 0, Low: 0 };
    let wrong = 0;
    for (const { properties: p } of doc.features) {
      const c = confidence(p, doc.meta);
      tally[c.level] += 1;
      const weak = !p.population_method.startsWith("2012 voters") + p.rent.estimated;
      const expected = p.status !== "scored" || weak === 2 ? "Low" : weak === 1 ? "Medium" : "High";
      if (c.level !== expected) wrong += 1;
      if (c.level !== "High" && !c.reasons.length) wrong += 1;
    }
    return { tally, wrong, thin: doc.features.filter((f) => f.properties.status !== "scored").length };
  });
  expect(counts.wrong).toBe(0);
  expect(counts.tally.Low).toBeGreaterThanOrEqual(counts.thin);
  expect(counts.tally.High + counts.tally.Medium + counts.tally.Low).toBe(140);
});

test("every row's fit label is its score's band, and the parts still add up", async ({ page }) => {
  await open(page, BRIEF);
  const rows = await page.locator(".pick").evaluateAll((els) => els.map((el) => ({
    score: Number(el.querySelector(".pick-score").textContent), fit: el.querySelector(".fit-tag").textContent.trim(),
  })));
  const expected = await page.evaluate(async (scores) => {
    const { fitBand } = await import("/js/insight.js");
    return scores.map((s) => fitBand(s).label);
  }, rows.map((r) => r.score));
  expect(rows.map((r) => r.fit)).toEqual(expected);
  await expect(page.locator(".pick .conf").first()).toHaveText(/(High|Medium|Low) confidence/);
});

test("the drawer's sensitivity table agrees with the shortlist under each budget", async ({ page }) => {
  await open(page, BRIEF);
  const name = await page.locator(".pick-name").first().innerText();
  await page.locator(".pick").first().click();
  const table = page.locator(".sens-table").first();
  await expect(table.locator("tr.current td")).toHaveText("#1");
  for (const budget of [50000, 75000]) {
    const shown = await table.locator("tr", { hasText: `₹${budget / 1000}k` }).locator("td").innerText();
    await page.goto(`/#cafe?for=offices&competition=avoid&budget=${budget}`);
    await page.reload();
    await page.locator("#results-title").waitFor();
    const names = await page.locator(".pick-name").allInnerTexts();
    const rank = names.indexOf(name) + 1;
    if (rank) expect(shown).toBe(`#${rank}`);
    else expect(Number(shown.slice(1))).toBeGreaterThan(5);
    await page.goto(`/${BRIEF}`);
    await page.reload();
    await page.locator(".pick").first().click();
  }
  await expect(page.locator(".sens-verdict")).toHaveText(/top 5 under \d+ of \d+|every one/);
});

test("a change of brief says what changed, and a baseline can be pinned and cleared", async ({ page }) => {
  await open(page, BRIEF);
  await page.locator("#budget").fill("50000");
  const strip = page.locator(".changes");
  await expect(strip).toContainText("Rent ceiling ₹35k → ₹50k");
  await expect(strip).toContainText(/wards fit/);
  await expect(strip).toContainText("Biggest mover");
  await strip.getByRole("button", { name: "Pin this as baseline" }).click();
  await expect(page.locator(".changes .eyebrow")).toHaveText("Baseline pinned");
  await page.getByRole("radio", { name: "QSR" }).click();
  await expect(page.locator(".changes .eyebrow")).toHaveText("Since your baseline");
  await expect(page.locator(".changes")).toContainText("Format Cafe → QSR");
  await page.getByRole("button", { name: "Clear baseline" }).click();
  await expect(page.locator(".changes")).toHaveCount(0);
});

test("the empty state offers every fix that applies, and only sensible ones", async ({ page }) => {
  await open(page, "#cafe/pmc?budget=5000");
  const empty = page.locator(".empty");
  await expect(empty).toContainText("No locations match your brief.");
  await expect(empty.getByRole("button")).toHaveText([/Raise the ceiling to ₹\d+k/, "Search all of Pune", "Include thin-data wards"]);
  await empty.getByRole("button", { name: "Search all of Pune" }).click();
  await expect(page).toHaveURL(/#cafe\?budget=5000$/);
  // Just short of the cheapest 300 sq ft rent: a smaller shop is offered.
  await page.goto("/#cafe?sqft=300&budget=20000");
  await page.reload();
  await expect(page.locator(".empty").getByRole("button", { name: /Look at \d+ sq ft instead/ })).toBeVisible();
});

test("compare marks a winner for each trade-off and shows confidence", async ({ page }) => {
  await open(page, BRIEF);
  const top = await page.locator(".pick-name").first().innerText();
  await page.getByRole("button", { name: "Compare the top 3" }).click();
  await expect(page.locator(".verdict-grid li").first()).toContainText(top);
  await expect(page.locator(".verdict-grid li")).toHaveCount(5);
  await expect(page.locator(".compare-table tr", { hasText: "Confidence" }).locator("td")).toHaveText([/High|Medium|Low/, /High|Medium|Low/, /High|Medium|Low/]);
});

test("the market view's figures add up to the data", async ({ page }) => {
  await open(page, BRIEF);
  const fit = await page.locator(".results-sub").innerText();
  await page.locator(".nav-link[data-value=market]").click();
  await expect(page.locator("#drawer-title")).toHaveText("Market overview");
  const doc = await page.evaluate(() => fetch("/data/wards.geojson").then((r) => r.json()));
  await expect(page.locator(".kpi").nth(1).locator("dd")).toContainText(doc.meta.outlets.toLocaleString("en-US"));
  const bands = (await page.locator("section[aria-labelledby=mk-fit] .bar-value").allInnerTexts()).map(Number);
  expect(String(bands.reduce((a, b) => a + b, 0))).toBe(fit.match(/(\d+) of 140 wards fit/)[1]);
  const levels = (await page.locator("section[aria-labelledby=mk-comp] .bar-value").allInnerTexts()).map(Number);
  expect(levels.reduce((a, b) => a + b, 0)).toBe(140);
});

test("methodology lists every source with its freshness, from the registry", async ({ page }) => {
  await open(page);
  await page.locator(".nav-link[data-action=method]").click();
  const doc = await page.evaluate(() => fetch("/data/wards.geojson").then((r) => r.json()));
  await expect(page.locator(".source")).toHaveCount(doc.meta.sources.length);
  await expect(page.locator(".source", { hasText: "Census of India" }).locator(".badge")).toHaveText("Low freshness");
  await expect(page.locator(".source", { hasText: "Food and drink places" }).locator(".badge")).toHaveText("High freshness");
  await page.locator(".method-index").getByRole("button", { name: "Confidence", exact: true }).click();
  await expect(page).toHaveURL(/#cafe$/);
});

test("the shortlist exports as CSV with the same scores", async ({ page }) => {
  await open(page, BRIEF);
  const scores = (await page.locator(".pick-score").allInnerTexts()).map(Number);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("localio-cafe-shortlist.csv");
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  const lines = text.replace(/^﻿/, "").trim().split("\r\n");
  expect(lines[0]).toMatch(/^rank,ward,corporation,ward_number,score,fit,/);
  const fitting = Number((await page.locator(".results-sub").innerText()).match(/(\d+) of 140/)[1]);
  expect(lines).toHaveLength(fitting + 1);
  expect(lines.slice(1, 6).map((l) => Number(l.split(",")[4]))).toEqual(scores);
});

test("the share dialog summarises the brief and copies the link", async ({ page }) => {
  await open(page, BRIEF);
  const names = await page.locator(".pick-name").allInnerTexts();
  await page.locator("[data-action=share-dialog]").first().click();
  await expect(page.locator(".share-list .share-name")).toHaveText(names);
  await expect(page.locator(".share-url")).toContainText("budget=35000");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator("#share-status")).toHaveText(/Link copied|Copy the link/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#share")).toBeHidden();
});

test("the command palette finds wards by locality and sets numbers", async ({ page }) => {
  await open(page);
  await page.keyboard.press("Control+k");
  await page.locator("#palette-input").fill("katraj");
  await expect(page.locator(".palette-item").first()).toContainText("Katraj");
  await page.keyboard.press("Enter");
  await expect(page.locator("#drawer-title")).toHaveText(/Katraj/);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.locator("#palette-input").fill("45k");
  await expect(page.locator(".palette-item").first()).toContainText("Rent ceiling: ₹45,000");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/budget=45000/);
  await expect(page.locator("#budget")).toHaveValue("45000");
});

test("every map layer has its own legend, and a fit band filters the map", async ({ page }) => {
  await open(page);
  const titles = { rent: "Rent tier", daytime: "Daytime draw", eating_out: "Eating out", residents: "Residents", confidence: "Data confidence" };
  for (const [mode, title] of Object.entries(titles)) {
    await page.locator(".layers-toggle").click();
    await page.locator(`[data-mode=${mode}]`).click();
    await expect(page.locator(".legend-title")).toHaveText(title);
    await expect(page.locator(".layers-toggle")).toContainText(title === "Data confidence" ? "Data confidence" : title);
  }
  await page.locator(".layers-toggle").click();
  await page.locator("[data-mode=fit]").click();
  await page.locator(".band", { hasText: "Good fit" }).click();
  await expect(page.locator(".band", { hasText: "Good fit" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".legend")).toHaveClass(/filtering/);
});

test("the theme can be switched, and the choice is remembered", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
});

test("an analyst answer carries its evidence, computed from the data", async ({ page }) => {
  await open(page, BRIEF);
  const score = await page.locator(".pick-score").first().innerText();
  const name = await page.locator(".pick-name").first().innerText();
  await page.getByRole("tab", { name: "Analyst" }).click();
  await page.locator("#ask-input").fill(`Why is ${name} first?`);
  await page.keyboard.press("Enter");
  const answer = page.locator(".msg-answer").last();
  await answer.getByText("Show evidence").click();
  await expect(answer.locator(".evidence tr", { hasText: "Score" }).locator("td")).toContainText(`${score} =`);
});

for (const scheme of ["light", "dark"]) {
  test(`every view meets 4.5:1 contrast in the ${scheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, BRIEF);
    const check = async (selector) => {
      const results = await new AxeBuilder({ page }).include(selector).withRules(["color-contrast"]).analyze();
      return results.violations.flatMap((v) => v.nodes.map((n) => `${selector}: ${n.target.join(" ")}`));
    };
    const found = [...await check("#topbar"), ...await check("#panel"), ...await check("#statusbar")];
    await page.locator(".pick").first().click();
    await page.waitForTimeout(300);
    found.push(...await check("#drawer"));
    for (const view of ["compare", "market"]) {
      await page.locator(`.nav-link[data-value=${view}]`).click();
      await page.waitForTimeout(300);
      found.push(...await check("#drawer"));
    }
    await page.locator(".nav-link[data-action=method]").click();
    await page.waitForTimeout(300);
    found.push(...await check("#drawer"));
    expect(found).toEqual([]);
  });
}

test("with reduced motion, re-ranking runs no animations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page);
  await page.getByRole("radio", { name: "Office workers and students" }).click();
  // CSS motion is cut to 0.01ms; nothing that actually lasts may run.
  const lasting = await page.evaluate(() => document.getAnimations()
    .filter((a) => a.playState === "running" && Number(a.effect.getTiming().duration) > 1).length);
  expect(lasting).toBe(0);
});

test("the keyboard alone opens the palette, picks a ward and closes it", async ({ page }) => {
  await open(page);
  await page.keyboard.press("/");
  await expect(page.locator("#palette")).toBeVisible();
  await page.keyboard.type("baner");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.locator("#palette")).toBeHidden();
  await expect(page.locator("#drawer-title")).toHaveText(/Baner/);
  await expect(page.locator("#drawer-title")).toBeFocused();
});
