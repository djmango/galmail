import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "line",
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "retain-on-failure",
    video: "on",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile-gestures\.e2e\.ts/,
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        hasTouch: true,
      },
      testMatch: /mobile-gestures\.e2e\.ts/,
    },
  ],
  webServer: {
    command: "bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      ...process.env,
      VITE_GALMAIL_PROVIDER_MODE: "fixture",
    },
  },
});
