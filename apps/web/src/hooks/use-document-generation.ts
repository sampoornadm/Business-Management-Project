"use client";

import { apiClient } from "@/lib/axios";

export async function downloadUndertaking(tenderId: string, tenderNumber: string): Promise<void> {
  const response = await apiClient.post<Blob>(
    `/tenders/${tenderId}/documents/undertaking`,
    undefined,
    { responseType: "blob" },
  );
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Undertaking-${tenderNumber}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export async function downloadQuotation(
  tenderId: string,
  tenderNumber: string,
  format: "docx" | "csv" | "pdf",
): Promise<void> {
  const response = await apiClient.post<Blob>(
    `/tenders/${tenderId}/documents/quotation?format=${format}`,
    undefined,
    { responseType: "blob" },
  );
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Quotation-${tenderNumber}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
