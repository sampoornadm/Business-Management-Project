import type { AxiosError } from "axios";
import { describe, expect, it } from "vitest";

import { extractApiErrorMessage } from "./axios";

function fakeAxiosError(overrides: Partial<AxiosError>): AxiosError {
  return { message: "Request failed with status code 409", isAxiosError: true, ...overrides } as AxiosError;
}

describe("extractApiErrorMessage", () => {
  it("returns the server's error message when the response carries one", async () => {
    const error = fakeAxiosError({
      response: {
        data: { success: false, error: { code: "CONFLICT", message: "This tender already has a project" } },
      } as AxiosError["response"],
    });

    await expect(extractApiErrorMessage(error)).resolves.toBe("This tender already has a project");
  });

  it("falls back to axios's generic message when the response body has no error field", async () => {
    const error = fakeAxiosError({ response: { data: {} } as AxiosError["response"] });

    await expect(extractApiErrorMessage(error)).resolves.toBe("Request failed with status code 409");
  });

  it("falls back to axios's generic message when there is no response at all (network error)", async () => {
    const error = fakeAxiosError({ response: undefined });

    await expect(extractApiErrorMessage(error)).resolves.toBe("Request failed with status code 409");
  });

  it("reads the server's error message out of a Blob body (blob-typed download requests)", async () => {
    const body = JSON.stringify({
      success: false,
      error: { code: "NOT_FOUND", message: "Signature not found for SAMSON. Place it at /some/path" },
    });
    const error = fakeAxiosError({
      response: { data: new Blob([body], { type: "application/json" }) } as AxiosError["response"],
    });

    await expect(extractApiErrorMessage(error)).resolves.toBe(
      "Signature not found for SAMSON. Place it at /some/path",
    );
  });

  it("falls back to axios's generic message when the Blob body isn't JSON (an actual file came back)", async () => {
    const error = fakeAxiosError({
      response: { data: new Blob(["%PDF-1.4 binary bytes"], { type: "application/pdf" }) } as AxiosError["response"],
    });

    await expect(extractApiErrorMessage(error)).resolves.toBe("Request failed with status code 409");
  });
});
