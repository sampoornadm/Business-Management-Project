"use client";

import type { ApiResponse, ContactLookupKind, ContactLookupOptionsDto } from "@bmp/types";
import { useQuery } from "@tanstack/react-query";

import { unwrap } from "@/lib/api";
import { apiClient } from "@/lib/axios";

export function useContactLookupOptions(kind: ContactLookupKind) {
  return useQuery({
    queryKey: ["contacts", "lookup-options", kind],
    queryFn: async () => {
      const response = await apiClient.get<ApiResponse<ContactLookupOptionsDto>>("/contacts/lookup-options", {
        params: { kind },
      });
      return unwrap(response.data);
    },
  });
}
