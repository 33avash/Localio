// Layout guard: each step at desktop, laptop and phone widths, compared with
// committed baselines. Tiles are blocked so only Localio's own drawing is
// compared. Update baselines deliberately with: make e2e-update
import { expect, test } from "@playwright/test";

import { blockTiles, open } from "./helpers.js";

const WIDTHS = { desktop: [1440, 900], laptop: [1024, 768], phone: [390, 844] };
const STEPS = { format: "#format/cafe", priority: "#priority/cafe/footfall", shortlist: "#shortlist/cafe/footfall",
  ask: "#ask/cafe/footfall" };

for (const [device, [width, height]] of Object.entries(WIDTHS)) {
  for (const [step, hash] of Object.entries(STEPS)) {
    test(`${step} at ${device} width`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await blockTiles(page);
      await open(page, hash);
      await expect(page.locator(".basemap-notice")).toBeVisible();
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot(`${step}-${device}.png`);
    });
  }
}
