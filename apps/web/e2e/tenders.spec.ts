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

    // Type, category, state and city are dropdowns; take the first option of each that is still
    // unset (a field with a default no longer shows its placeholder). City follows state.
    for (const placeholder of ["Select type", "Select category", "Select state", "Select city"]) {
      const trigger = page.locator('button[role="combobox"]', { hasText: placeholder });
      if ((await trigger.count()) > 0) {
        await trigger.click();
        await page.getByRole("option").first().click();
      }
    }
    await page.fill('input[name="estimatedCost"]', "500000");

    const submissionDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16); // datetime-local wants YYYY-MM-DDTHH:mm
    await page.fill('input[name="submissionDate"]', submissionDate);

    await page.click('button:text-is("Create tender")');
    await page.waitForURL(/\/tenders\/(?!new)[a-f0-9-]+$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: tenderTitle })).toBeVisible();

    // Submitting needs the rates finalized first, so a fresh tender's Submitted stage explains
    // that instead of moving. (Finalizing and submitting is covered by the server's integration tests.)
    await page.getByRole("button", { name: "Submitted", exact: true }).click();
    await expect(page.getByText("Finalize rates first").first()).toBeVisible({ timeout: 10_000 });

    await page.goto("/tenders");
    await expect(page.getByText(tenderTitle)).toBeVisible();
  });

  test("shows a filtered-empty state when no tenders match the search", async ({ page }) => {
    await login(page);
    await page.goto("/tenders");
    await page.fill('input[placeholder="Search by title or tender number..."]', `no-such-tender-${Date.now()}`);
    await expect(page.getByText("No tenders match your filters")).toBeVisible();
  });
});
