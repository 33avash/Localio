// Layout guard: each tab at desktop, laptop and phone widths, compared with
// committed baselines. Tiles are blocked so only Localio's own drawing is
// compared. Update baselines deliberately with: make e2e-update
import { expect, test } from "@playwright/test";

import { blockTiles, open } from "./helpers.js";

const WIDTHS = { desktop: [1440, 900], laptop: [1024, 768], phone: [390, 844] };
// The two tabs, each opened from the default plan.
const VIEWS = { plan: null, ask: "Ask" };

for (const [device, [width, height]] of Object.entries(WIDTHS)) {
  for (const [view, tab] of Object.entries(VIEWS)) {
    test(`${view} at ${device} width`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await blockTiles(page);
      await open(page);
      if (tab) await page.getByRole("tab", { name: tab }).click();
      await expect(page.locator(".basemap-notice")).toBeVisible();
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot(`${view}-${device}.png`);
    });
  }
}
