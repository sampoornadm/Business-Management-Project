import { describe, expect, it } from "vitest";

import { unwrap } from "./api";

describe("unwrap", () => {
  it("returns the data payload on a successful response", () => {
    const result = unwrap({ success: true, data: { id: "1" }, message: "OK" });
    expect(result).toEqual({ id: "1" });
  });

  it("throws with the server's error message on a failed response", () => {
    expect(() =>
      unwrap({ success: false, error: { message: "Not found", code: "NOT_FOUND" } }),
    ).toThrow("Not found");
  });
});
