import { expect, test } from "@playwright/test";

import { API_BASE_URL, apiLogin, login } from "./helpers";

test.describe("Tenders", () => {
  let organizationName: string;
  let tenderTitle: string;

  test.beforeAll(async ({ request }) => {
    const accessToken = await apiLogin(request);
    organizationName = `E2E Client ${Date.now()}`;
    tenderTitle = `E2E Tender ${Date.now()}`;

    const response = await request.post(`${API_BASE_URL}/organizations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: organizationName, type: "PRIVATE" },
    });
    expect(response.ok()).toBe(true);
  });

  test("creates a tender via the form, then changes its status", async ({ page }) => {
    await login(page);

    await page.goto("/tenders/new");
    await page.fill('input[name="tenderNumber"]', `TND-E2E-${Date.now()}`);
    await page.fill('input[name="department"]', "PWD");
    await page.fill('input[name="title"]', tenderTitle);

    await page.locator('button[role="combobox"]', { hasText: "Select a client organization" }).click();
    await page.getByRole("option", { name: organizationName }).click();

    await page.locator('button[role="combobox"]', { hasText: "Select type" }).click();
    await page.getByRole("option").first().click();

    await page.locator('button[role="combobox"]', { hasText: "Select category" }).click();
    await page.getByRole("option").first().click();

    await page.fill('input[name="location"]', "Test City");
    await page.fill('input[name="state"]', "Test State");
    await page.fill('input[name="estimatedCost"]', "500000");

    const submissionDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.fill('input[name="submissionDate"]', submissionDate);

    await page.click('button:text-is("Create tender")');
    await page.waitForURL(/\/tenders\/(?!new)[a-f0-9-]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: tenderTitle })).toBeVisible();

    // DRAFT -> SUBMITTED is the tender's first allowed status transition.
    const headerRow = page.locator("div.flex.items-center.gap-2", {
      has: page.getByRole("heading", { name: tenderTitle }),
    });
    await page.click('button:has-text("Change status")');
    await page.locator('div[role="dialog"] button[role="combobox"]').click();
    await page.getByRole("option", { name: "Submitted" }).click();
    await page.click('div[role="dialog"] button:text-is("Confirm")');
    await expect(headerRow.getByText("Submitted")).toBeVisible({ timeout: 10_000 });

    await page.goto("/tenders");
    await expect(page.getByText(tenderTitle)).toBeVisible();
  });
});
