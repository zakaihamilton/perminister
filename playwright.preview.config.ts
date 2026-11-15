import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:3217";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "responsive-ui.spec.ts",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "PERMINISTER_UI_PREVIEW=1 WATCHPACK_POLLING=true ./node_modules/.bin/next dev --webpack --hostname 127.0.0.1 --port 3217",
    url: `${baseURL}/ui-preview`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
