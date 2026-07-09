import { expect, test } from "@playwright/test";

import { API_BASE_URL, apiLogin, login } from "./helpers";

test.describe("Tender documents", () => {
  let tenderId: string;
  let tenderTitle: string;

  test.beforeAll(async ({ request }) => {
    const accessToken = await apiLogin(request);
    tenderTitle = `E2E Documents Tender ${Date.now()}`;

    const orgResponse = await request.post(`${API_BASE_URL}/organizations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: `E2E Documents Client ${Date.now()}`, type: "PRIVATE" },
    });
    const org = (await orgResponse.json()).data;

    const tenderResponse = await request.post(`${API_BASE_URL}/tenders`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        tenderNumber: `TND-E2E-DOC-${Date.now()}`,
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
    tenderId = (await tenderResponse.json()).data.id;
  });

  test("uploads, replaces, and deletes a document as a compact row; supports multiple files per type", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/tenders/${tenderId}`);
    await page.getByRole("tab", { name: "Documents" }).click();

    const boqSection = page.getByRole("group", { name: "Bill of Quantities (BOQ)" });
    await expect(boqSection.getByText("No file uploaded")).toBeVisible();

    await boqSection.locator('input[type="file"]').setInputFiles({
      name: "boq-v1.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("first version"),
    });
    await expect(boqSection.getByText("boq-v1.txt")).toBeVisible({ timeout: 10_000 });
    await expect(boqSection.getByRole("button", { name: "Replace" })).toBeVisible();

    // Replace with a second version.
    await boqSection.locator('input[type="file"]').setInputFiles({
      name: "boq-v2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("second version"),
    });
    await expect(boqSection.getByText("boq-v2.txt")).toBeVisible({ timeout: 10_000 });
    await boqSection.getByRole("button", { name: /version history/ }).click();
    await expect(boqSection.getByText("v2")).toBeVisible();
    await expect(boqSection.getByText("v1")).toBeVisible();

    // Delete it — back to the empty-row state.
    page.once("dialog", (dialog) => dialog.accept());
    await boqSection.getByRole("button", { name: "Delete file" }).click();
    await expect(boqSection.getByText("No file uploaded")).toBeVisible({ timeout: 10_000 });

    // A type that already has a file shows "Add another file" instead of a second empty row.
    const drawingsSection = page.getByRole("group", { name: "Drawings" });
    await drawingsSection.locator('input[type="file"]').setInputFiles({
      name: "drawing-1.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("drawing one"),
    });
    await expect(drawingsSection.getByText("drawing-1.txt")).toBeVisible({ timeout: 10_000 });

    await expect(drawingsSection.getByRole("button", { name: "Add another file" })).toBeVisible();
    await drawingsSection.locator('input[type="file"]').last().setInputFiles({
      name: "drawing-2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("drawing two"),
    });
    await expect(drawingsSection.getByText("drawing-1.txt")).toBeVisible({ timeout: 10_000 });
    await expect(drawingsSection.getByText("drawing-2.txt")).toBeVisible({ timeout: 10_000 });
  });
});
