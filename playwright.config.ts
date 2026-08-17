import { defineConfig } from "@playwright/test";

/**
 * E2E suite for Slate. Assumes the dev servers are running (`pnpm dev`);
 * `reuseExistingServer` means it will not try to spawn its own when :3000
 * is already serving.
 */
export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 3,
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/sign-in",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
