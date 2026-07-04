import { expect, test } from "@playwright/test";

import { API_BASE_URL, apiLogin, login } from "./helpers";

test.describe("Reports and search", () => {
  let tenderTitle: string;

  test.beforeAll(async ({ request }) => {
    const accessToken = await apiLogin(request);
    tenderTitle = `E2E Searchable Tender ${Date.now()}`;

    const orgResponse = await request.post(`${API_BASE_URL}/organizations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: `E2E Reports Client ${Date.now()}`, type: "GOVERNMENT" },
    });
    const org = (await orgResponse.json()).data;

    const tenderResponse = await request.post(`${API_BASE_URL}/tenders`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        tenderNumber: `TND-E2E-RPT-${Date.now()}`,
        title: tenderTitle,
        department: "PWD",
        clientId: org.id,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 500000,
        submissionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        priority: "MEDIUM",
      },
    });
    expect(tenderResponse.ok()).toBe(true);
  });

  test("renders every report tab with data and exports one to Excel", async ({ page }) => {
    await login(page);
    await page.goto("/reports");

    await expect(page.getByText("Win rate")).toBeVisible();
    await expect(page.getByText("Tenders by status")).toBeVisible();

    for (const tab of ["Procurement Spend", "Project Costing", "Financial Summary", "Vendor Performance"]) {
      await page.getByRole("tab", { name: tab }).click();
      await page.waitForTimeout(300);
    }

    await page.getByRole("tab", { name: "Tender Pipeline" }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Excel" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("tender-pipeline.xlsx");
  });

  test("finds a tender via the topbar search and the dedicated search page", async ({ page }) => {
    await login(page);

    const searchInput = page.getByLabel("Global search");
    await searchInput.fill(tenderTitle.split(" ").slice(-2).join(" "));
    await expect(page.getByText(tenderTitle).first()).toBeVisible({ timeout: 10_000 });

    await searchInput.press("Enter");
    await page.waitForURL(/\/search\?q=/, { timeout: 10_000 });
    await expect(page.getByRole("link", { name: new RegExp(tenderTitle) })).toBeVisible();
  });
});
