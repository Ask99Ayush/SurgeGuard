import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the running Compose stack (`make up` first).
 *   CONSOLE_URL  admin console / landing (default http://localhost:3000)
 *   SITE_URL     protected entry point   (default http://localhost:8080)
 *   E2E_ADMIN_PASSWORD  admin password (admin tests are skipped without it)
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.CONSOLE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    colorScheme: "dark",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /waiting-room|landing/ },
  ],
});
