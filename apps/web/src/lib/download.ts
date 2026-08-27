import { apiClient } from "@/lib/axios";

// The server names every downloaded file after its real subject (an RFQ's title, a bill's
// number) via Content-Disposition — read it back rather than falling to a raw UUID/id, which
// is meaningless once the file is sitting in someone's Downloads folder.
function filenameFromContentDisposition(disposition: unknown, fallback: string): string {
  const match = typeof disposition === "string" ? /filename="?([^";]+)"?/.exec(disposition) : null;
  return match?.[1] ?? fallback;
}

export async function downloadFile(path: string, fallbackFilename: string): Promise<void> {
  const response = await apiClient.get(path, { responseType: "blob" });
  const filename = filenameFromContentDisposition(response.headers["content-disposition"], fallbackFilename);
  const url = URL.createObjectURL(response.data as Blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
