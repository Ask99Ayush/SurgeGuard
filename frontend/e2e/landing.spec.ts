import { expect, test } from "@playwright/test";

test("landing page shows the hero, features and architecture", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Survive the surge.");
  for (const title of ["Fair Queueing", "Controlled Admission", "Backend Protection", "Observability"]) {
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  }
  await page.getByRole("link", { name: /view architecture/i }).click();
  await expect(page.locator("#architecture")).toBeInViewport();
  if (process.env.SCREENSHOTS) await page.screenshot({ path: `${process.env.SCREENSHOTS}/landing-${test.info().project.name}.png`, fullPage: true });
});

test("Launch Dashboard requires login", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /launch dashboard/i }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Operator console" })).toBeVisible();
});
