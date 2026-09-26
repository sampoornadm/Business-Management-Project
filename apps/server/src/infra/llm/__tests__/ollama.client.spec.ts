import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceUnavailableError } from "../../../core/errors/HttpErrors.js";
import { generateText } from "../ollama.client.js";

describe("generateText", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("aborts and throws ServiceUnavailableError when the call exceeds timeoutMs", async () => {
    // Simulates a slow/stuck Ollama call (the real-world trigger: a large tender-notes section
    // cleanup that never returns) — the fetch never resolves on its own, only reacts to abort.
    global.fetch = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    }) as unknown as typeof fetch;

    await expect(
      generateText("prompt", "llama3.1:8b", { timeoutMs: 10 }),
    ).rejects.toBeInstanceOf(ServiceUnavailableError);
  });

  it("has no timeout by default, so a slow-but-eventually-resolving call still succeeds", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ response: "hello" }),
    })) as unknown as typeof fetch;

    await expect(generateText("prompt")).resolves.toBe("hello");
  });
});
