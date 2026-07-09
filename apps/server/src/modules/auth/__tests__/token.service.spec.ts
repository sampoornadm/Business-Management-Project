import { describe, expect, it } from "vitest";

import { TokenService } from "../token.service.js";

describe("TokenService", () => {
  it("round-trips businessId through sign/verify", () => {
    const service = new TokenService();
    const { token } = service.signAccessToken({
      sub: "user-1",
      roleId: "role-1",
      roleName: "ADMIN",
      businessId: "business-1",
    });
    const decoded = service.verifyAccessToken(token);
    expect(decoded.businessId).toBe("business-1");
  });
});
