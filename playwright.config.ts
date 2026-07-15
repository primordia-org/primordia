import { defineConfig, devices } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, "tests/.auth/session.json");

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  timeout: 20 * 60 * 1000, // 20 min per test — full demo runs Claude twice + deploys
  expect: { timeout: 10_000 },
  fullyParallel: false, // thread tests mutate server state
  retries: 0,
  reporter: "line",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    storageState: AUTH_FILE,
    trace: "on-first-retry",
    headless: false, // run headed by default so the demo is visible
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
