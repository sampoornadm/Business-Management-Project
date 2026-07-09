import { expect, test } from "@playwright/test";

import { API_BASE_URL, apiLogin, login } from "./helpers";

// A minimal valid 1x1 PNG. `text/plain` is not in the server's
// GENERIC_UPLOAD_LIMITS.ALLOWED_MIME_TYPES allowlist, and the upload service
// sniffs real magic bytes (file-type) rather than trusting the declared
// Content-Type, so fixtures need genuinely-valid image bytes, not just a
// text buffer with an image mimeType label.
const PNG_BUFFER = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

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
      name: "boq-v1.png",
      mimeType: "image/png",
      buffer: PNG_BUFFER,
    });
    await expect(boqSection.getByText("boq-v1.png")).toBeVisible({ timeout: 10_000 });
    await expect(boqSection.getByRole("button", { name: "Replace" })).toBeVisible();

    // Replace with a second version. Once a type has a file, its section also renders
    // an "Add another file" input alongside the existing lineage's replace input — the
    // first input in DOM order is always the existing lineage's.
    await boqSection.locator('input[type="file"]').first().setInputFiles({
      name: "boq-v2.png",
      mimeType: "image/png",
      buffer: PNG_BUFFER,
    });
    await expect(boqSection.getByText("boq-v2.png")).toBeVisible({ timeout: 10_000 });
    await boqSection.getByRole("button", { name: /version history/ }).click();
    // exact: true — the filename ("boq-v2.png") and meta line ("... · v2 · ...") both
    // contain "v2"/"v1" as substrings too; only the version Badge's text is exactly this.
    await expect(boqSection.getByText("v2", { exact: true })).toBeVisible();
    await expect(boqSection.getByText("v1", { exact: true })).toBeVisible();

    // Delete it — back to the empty-row state.
    page.once("dialog", (dialog) => dialog.accept());
    await boqSection.getByRole("button", { name: "Delete file" }).click();
    await expect(boqSection.getByText("No file uploaded")).toBeVisible({ timeout: 10_000 });

    // A type that already has a file shows "Add another file" instead of a second empty row.
    const drawingsSection = page.getByRole("group", { name: "Drawings" });
    await drawingsSection.locator('input[type="file"]').setInputFiles({
      name: "drawing-1.png",
      mimeType: "image/png",
      buffer: PNG_BUFFER,
    });
    await expect(drawingsSection.getByText("drawing-1.png")).toBeVisible({ timeout: 10_000 });

    await expect(drawingsSection.getByRole("button", { name: "Add another file" })).toBeVisible();
    await drawingsSection.locator('input[type="file"]').last().setInputFiles({
      name: "drawing-2.png",
      mimeType: "image/png",
      buffer: PNG_BUFFER,
    });
    await expect(drawingsSection.getByText("drawing-1.png")).toBeVisible({ timeout: 10_000 });
    await expect(drawingsSection.getByText("drawing-2.png")).toBeVisible({ timeout: 10_000 });
  });
});
