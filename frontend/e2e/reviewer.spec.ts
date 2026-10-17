import { expect, test } from "@playwright/test";

// Requires REVIEWER_LOGIN_ENABLED=true; pass the password from .env as E2E_REVIEWER_PASSWORD.
const PASSWORD = process.env.E2E_REVIEWER_PASSWORD;

test("reviewer has full permissions: pause and resume admission", async ({ page }) => {
  test.skip(!PASSWORD, "set E2E_REVIEWER_PASSWORD to run");
  await page.goto("/login?next=/dashboard");
  // The reviewer password is never displayed on the login page.
  await expect(page.locator("body")).not.toContainText(PASSWORD ?? "");
  await page.getByLabel("Username").fill("reviewer");
  await page.getByLabel("Password").fill(PASSWORD ?? "");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByText("Read-only demo")).toHaveCount(0);

  await page.getByRole("button", { name: /pause admission/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Pause admission" }).click();
  await expect(page.getByText(/^Paused/)).toBeVisible();

  await page.getByRole("button", { name: /resume admission/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Admitting")).toBeVisible();
});
