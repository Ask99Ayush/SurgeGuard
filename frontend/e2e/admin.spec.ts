import { expect, test } from "@playwright/test";

const PASSWORD = process.env.E2E_ADMIN_PASSWORD;
const USER = process.env.E2E_ADMIN_USER ?? "admin";

test("admin pages redirect to login when signed out", async ({ page }) => {
  for (const path of ["/dashboard", "/queue", "/backends", "/monitoring", "/settings"]) {
    await page.goto(path);
    await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}`));
  }
  const api = await page.request.get("/api/admin/overview");
  expect(api.status()).toBe(401);
});

test("wrong password is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill(USER);
  await page.getByLabel("Password").fill("definitely-not-the-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.locator("#login-error")).toContainText(/incorrect|too many/i);
});

test.describe("signed in", () => {
  test.skip(!PASSWORD, "set E2E_ADMIN_PASSWORD to run admin flows");

  test.beforeEach(async ({ page }) => {
    await page.goto("/login?next=/dashboard");
    await page.getByLabel("Username").fill(USER);
    await page.getByLabel("Password").fill(PASSWORD ?? "");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  });

  const nav = (page: import("@playwright/test").Page, name: string) =>
    page.getByRole("navigation", { name: "Console" }).getByRole("link", { name });

  test("dashboard shows live data from the API", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
    await expect(page.getByText("SurgeGuard API").locator("..").locator("..")).toContainText("reachable");
    await expect(page.getByText("Admitting").or(page.getByText(/^Paused/))).toBeVisible();
    if (process.env.SCREENSHOTS) {
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${process.env.SCREENSHOTS}/dashboard.png`, fullPage: true });
    }
  });

  test("queue page lists visitors and pause needs confirmation", async ({ page }) => {
    await nav(page, "Queue").click();
    await page.waitForURL(/\/queue$/);
    await expect(page.getByRole("tab", { name: /^all/i })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: /pause admission/i }).click();
    const dialog = page.getByRole("alertdialog", { name: "Pause admission?" });
    await expect(dialog).toBeVisible();
    if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/queue-confirm.png` });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
  });

  test("backends, monitoring and settings render", async ({ page }) => {
    await nav(page, "Backends").click();
    await expect(page.getByRole("cell", { name: /demo-1/ })).toBeVisible();
    if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/backends.png`, fullPage: true });
    await nav(page, "Monitoring").click();
    await expect(page.getByRole("heading", { name: "Monitoring" })).toBeVisible();
    await nav(page, "Settings").click();
    await expect(page.getByText("Active key id")).toBeVisible();
    if (process.env.SCREENSHOTS) {
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${process.env.SCREENSHOTS}/settings.png`, fullPage: true });
    }
  });

  test("logout ends the session", async ({ page }) => {
    await page.getByRole("button", { name: /log out/i }).click();
    await page.waitForURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
