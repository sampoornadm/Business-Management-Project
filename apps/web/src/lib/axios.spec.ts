import type { AxiosError } from "axios";
import { describe, expect, it } from "vitest";

import { extractApiErrorMessage } from "./axios";

function fakeAxiosError(overrides: Partial<AxiosError>): AxiosError {
  return { message: "Request failed with status code 409", isAxiosError: true, ...overrides } as AxiosError;
}

describe("extractApiErrorMessage", () => {
  it("returns the server's error message when the response carries one", () => {
    const error = fakeAxiosError({
      response: {
        data: { success: false, error: { code: "CONFLICT", message: "This tender already has a project" } },
      } as AxiosError["response"],
    });

    expect(extractApiErrorMessage(error)).toBe("This tender already has a project");
  });

  it("falls back to axios's generic message when the response body has no error field", () => {
    const error = fakeAxiosError({ response: { data: {} } as AxiosError["response"] });

    expect(extractApiErrorMessage(error)).toBe("Request failed with status code 409");
  });

  it("falls back to axios's generic message when there is no response at all (network error)", () => {
    const error = fakeAxiosError({ response: undefined });

    expect(extractApiErrorMessage(error)).toBe("Request failed with status code 409");
  });
});
