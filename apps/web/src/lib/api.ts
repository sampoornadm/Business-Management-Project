import type { ApiResponse } from "@bmp/types";

export function unwrap<T>(data: ApiResponse<T>): T {
  if (!data.success) throw new Error(data.error.message);
  return data.data;
}
