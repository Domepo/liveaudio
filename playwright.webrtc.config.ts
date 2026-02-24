import { defineConfig } from "@playwright/test";

const baseURL = process.env.WEB_BASE_URL || "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/webrtc/playwright",
  timeout: 120_000,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report-webrtc", open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    video: "retain-on-failure"
  }
});
