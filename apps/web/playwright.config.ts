import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: "test-results",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: isCI
    ? [
        ["github"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ]
    : [
        ["list"],
        ["html", { open: "never", outputFolder: "playwright-report" }],
      ],
  use: {
    baseURL: "http://127.0.0.1:1420",
    trace: "retain-on-failure",
    // Desktop defaults; mobile-chrome overrides video/screenshot below.
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /mobile-.*\.e2e\.ts/,
    },
    {
      name: "mobile-chrome",
      use: {
        ...devices["Pixel 7"],
        hasTouch: true,
        // Always record mobile UX so agents can inspect gesture videos.
        video: "on",
        screenshot: "only-on-failure",
      },
      testMatch: /mobile-.*\.e2e\.ts/,
    },
  ],
  webServer: {
    command: "bun run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !isCI,
    timeout: 30_000,
    env: {
      ...process.env,
      VITE_GALMAIL_PROVIDER_MODE: "fixture",
    },
  },
});
