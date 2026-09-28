// Runs inside the official Playwright image (see Dockerfile), so fonts and
// rendering are the same locally and in CI, which the visual baselines need.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "specs",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8080",
    browserName: "chromium",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: "disabled" },
  },
});
