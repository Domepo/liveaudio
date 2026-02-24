import { expect, test } from "@playwright/test";

test("login page renders and requires credentials", async ({ page }) => {
  await page.goto("/login");

  await expect(page.locator("#admin-name")).toBeVisible();
  await expect(page.locator("#admin-password")).toBeVisible();
  const submitButton = page.locator("#admin-login-submit");
  await expect(submitButton).toBeDisabled();

  await page.locator("#admin-name").fill("admin");
  await page.locator("#admin-password").fill("secret");

  await expect(submitButton).toBeEnabled();
});
