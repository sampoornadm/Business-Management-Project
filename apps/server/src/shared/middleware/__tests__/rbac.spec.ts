import { PERMISSION_KEYS, ROLE_PERMISSION_MATRIX } from "@bmp/types";
import { describe, expect, it } from "vitest";

describe("settings permissions", () => {
  it("are not granted to ADMIN or any non-SUPER_ADMIN role", () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSION_MATRIX)) {
      if (role === "SUPER_ADMIN") continue;
      expect(permissions).not.toContain("settings:read");
      expect(permissions).not.toContain("settings:manage");
    }
  });

  it("exist as valid permission keys", () => {
    expect(PERMISSION_KEYS).toContain("settings:read");
    expect(PERMISSION_KEYS).toContain("settings:manage");
  });
});
