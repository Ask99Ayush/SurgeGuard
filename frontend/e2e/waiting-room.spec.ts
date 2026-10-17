import { expect, test } from "@playwright/test";

const SITE = process.env.SITE_URL ?? "http://localhost:8080";

test("visitor joins, waits and is admitted to the protected site", async ({ page }) => {
  await page.goto(`${SITE}/`);
  // No admission token: Nginx sends us to the waiting room.
  await expect(page).toHaveURL(/\/waiting-room$/);
  await expect(page.getByText(/finding your place|you're in line|you're in\./i).first()).toBeVisible();
  if (process.env.SCREENSHOTS) {
    await page.screenshot({ path: `${process.env.SCREENSHOTS}/waiting-room-${test.info().project.name}.png` });
  }
  // The worker admits at the configured rate; we end up on the origin page.
  await page.waitForURL(`${SITE}/`, { timeout: 45_000 });
  await expect(page.getByRole("heading", { name: /results/i })).toBeVisible();

  // The admission token is reusable: navigating and submitting a form works.
  await page.getByLabel("Roll number").fill("20261234");
  await page.getByRole("button", { name: "View result" }).click();
  await expect(page.getByRole("heading", { name: /result for roll 20261234/i })).toBeVisible();
});

test("admission cookies are HttpOnly and SameSite=Lax", async ({ page, context }) => {
  await page.goto(`${SITE}/`);
  await page.waitForURL(`${SITE}/`, { timeout: 45_000 });
  const cookies = await context.cookies(SITE);
  for (const name of ["sg_vid", "sg_admission"]) {
    const c = cookies.find((x) => x.name === name);
    expect(c, name).toBeDefined();
    expect(c?.httpOnly).toBe(true);
    expect(c?.sameSite).toBe("Lax");
  }
  // Not readable from page scripts.
  expect(await page.evaluate(() => document.cookie)).not.toContain("sg_admission");
});
