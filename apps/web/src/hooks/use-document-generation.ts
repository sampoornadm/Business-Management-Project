"use client";

import axios from "axios";

import { apiClient } from "@/lib/axios";

export async function downloadUndertaking(tenderId: string, tenderNumber: string): Promise<void> {
  try {
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
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
      const text = await error.response.data.text();
      let parsed: { error?: { message?: string } } | undefined;
      try {
        parsed = JSON.parse(text) as { error?: { message?: string } };
      } catch {
        // Body wasn't JSON — fall through to rethrow the original error below.
      }
      if (parsed?.error?.message) throw new Error(parsed.error.message);
    }
    throw error;
  }
}
