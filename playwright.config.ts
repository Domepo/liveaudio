import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  webServer: [
    {
      command: "npm run start:test:api",
      url: "http://127.0.0.1:3000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    },
    {
      command: "npm run start:test:web",
      url: "http://127.0.0.1:4173/login",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000
    }
  ]
});
