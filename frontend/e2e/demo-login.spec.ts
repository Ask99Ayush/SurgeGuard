import { expect, test } from "@playwright/test";

// Requires DEMO_LOGIN_ENABLED=true. Checks whichever role DEMO_ROLE grants (admin or viewer).
test("demo account signs in with the configured permissions", async ({ page }) => {
  await page.goto("/login?next=/dashboard");
  const demoButton = page.getByRole("button", { name: /use demo account/i });
  test.skip(!(await demoButton.isVisible()), "demo login disabled");
  await demoButton.click();
  await page.waitForURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Operations" })).toBeVisible();
  const fullAccess = (await page.getByText("Read-only demo").count()) === 0;
  expect((await page.request.get("/api/admin/overview")).status()).toBe(200);

  const control = page.getByRole("button", { name: /pause admission|resume admission/i });
  if (!fullAccess) {
    await expect(page.getByText("Read-only demo")).toBeVisible();
    await expect(control).toBeDisabled();
    const origin = new URL(page.url()).origin;
    const pause = await page.request.post("/api/admin/queue/pause", { data: { reason: "x" }, headers: { Origin: origin } });
    expect(pause.status()).toBe(403);
    return;
  }
  // Full access: pause and resume through the confirmation dialog.
  await expect(page.getByText("Read-only demo")).toHaveCount(0);
  await page.getByRole("button", { name: /pause admission/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Pause admission" }).click();
  await expect(page.getByText(/^Paused/)).toBeVisible();
  await page.getByRole("button", { name: /resume admission/i }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Admitting")).toBeVisible();
});
