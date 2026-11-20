import { defineConfig, devices } from "@playwright/test";

const PORT = 5301;

export default defineConfig({
  forbidOnly: Boolean(process.env.CI),
  // One test at a time: the time budgets mean nothing if tests compete for the CPU.
  fullyParallel: false,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // `adaptive` slows the CPU through Chromium's DevTools protocol.
    {
      name: "firefox",
      testIgnore: "**/adaptive.e2e.ts",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: "**/adaptive.e2e.ts",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // A shared CI runner has bad moments: a budget missed once is retried.
  retries: process.env.CI ? 2 : 0,
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required"],
    },
  },
  webServer: {
    command: `bunx vite e2e --port ${PORT} --strictPort`,
    reuseExistingServer: !process.env.CI,
    url: `http://localhost:${PORT}/page.html`,
  },
  workers: 1,
});
