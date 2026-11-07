"use client";

import { apiClient } from "@/lib/axios";

async function downloadGenerated(path: string, filename: string): Promise<void> {
  const response = await apiClient.post<Blob>(path, undefined, { responseType: "blob" });
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export function downloadUndertaking(
  tenderId: string,
  tenderNumber: string,
  format: "pdf" | "docx" = "pdf",
): Promise<void> {
  return downloadGenerated(
    `/tenders/${tenderId}/documents/undertaking?format=${format}`,
    `Undertaking-${tenderNumber}.${format}`,
  );
}

export function downloadQuotation(
  tenderId: string,
  tenderNumber: string,
  format: "docx" | "csv" | "pdf",
): Promise<void> {
  return downloadGenerated(
    `/tenders/${tenderId}/documents/quotation?format=${format}`,
    `Quotation-${tenderNumber}.${format}`,
  );
}

export function downloadTenderSheet(tenderId: string, tenderNumber: string, format: "pdf" | "docx"): Promise<void> {
  return downloadGenerated(
    `/tenders/${tenderId}/documents/tender-sheet?format=${format}`,
    `Tender-Sheet-${tenderNumber}.${format}`,
  );
}
