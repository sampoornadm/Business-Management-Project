import { describe, expect, it } from "vitest";

import { hasPermission } from "./permissions";

describe("hasPermission", () => {
  it("returns false when no role is provided", () => {
    expect(hasPermission(undefined, "tenders:read")).toBe(false);
  });

  it("grants every permission to SUPER_ADMIN without consulting the matrix", () => {
    expect(hasPermission("SUPER_ADMIN", "users:delete")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "reports:read")).toBe(true);
  });

  it("grants a permission a role's matrix entry includes", () => {
    expect(hasPermission("VIEWER", "users:read")).toBe(true);
  });

  it("denies a permission a role's matrix entry does not include", () => {
    expect(hasPermission("VIEWER", "users:create")).toBe(false);
  });

  it("grants ADMIN standard operational permissions", () => {
    expect(hasPermission("ADMIN", "tenders:read")).toBe(true);
    expect(hasPermission("ADMIN", "finance:read")).toBe(true);
  });
});
