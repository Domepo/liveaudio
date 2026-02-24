import { expect, test } from "@playwright/test";

test("login page renders and requires credentials", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Login" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeDisabled();

  await page.getByLabel("Name").fill("admin");
  await page.getByLabel("Passwort").fill("secret");

  await expect(page.getByRole("button", { name: "Anmelden" })).toBeEnabled();
});
