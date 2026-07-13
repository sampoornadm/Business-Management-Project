"use client";

import { apiClient } from "@/lib/axios";

export async function downloadUndertaking(tenderId: string): Promise<void> {
  const response = await apiClient.post<Blob>(
    `/tenders/${tenderId}/documents/undertaking`,
    undefined,
    { responseType: "blob" },
  );
  const url = window.URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Undertaking-${tenderId}.docx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}
