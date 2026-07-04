import { expect, test } from "@playwright/test";

import { login } from "./helpers";

test.describe("Authentication", () => {
  test("redirects an unauthenticated visitor to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL("**/login", { timeout: 10_000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });

  test("logs in and lands on the dashboard with real widgets", async ({ page }) => {
    await login(page);

    await expect(page.getByText(/Welcome back/i)).toBeVisible();
    await expect(page.getByText("Total Users")).toBeVisible();
    await expect(page.getByText("System Health")).toBeVisible();
  });

  test("logs out via the user menu and redirects back to /login", async ({ page }) => {
    await login(page);

    await page.locator("header button.rounded-full").click();
    await page.getByText("Log out").click();
    await page.waitForURL("**/login", { timeout: 10_000 });
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});
