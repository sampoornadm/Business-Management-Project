import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_CHARS, summariseTrainerError } from "../classification.errors.js";

describe("summariseTrainerError", () => {
  it("keeps the line that actually says what went wrong", () => {
    const raw = [
      "train.py failed: Command failed: uv run --extra export python train.py",
      "Warning: You are sending unauthenticated requests to the HF Hub.",
      "Loading weights: 100%|##########| 199/199",
      "RuntimeError: MPS backend out of memory",
    ].join("\n");

    expect(summariseTrainerError(raw)).toContain("MPS backend out of memory");
  });

  it("drops the progress bars and warnings that made the card unreadable", () => {
    // The card showed an entire stderr dump: HF token warnings, tqdm bars, a deprecation notice
    // and a leaked-semaphore warning — none of which say why the run failed.
    const raw = [
      "train.py failed: Command failed: uv run --extra export python train.py",
      "Warning: You are sending unauthenticated requests to the HF Hub. Please set a HF_TOKEN",
      "Loading weights:   0%|          | 0/199 [00:00<?, ?it/s]",
      "Loading weights: 100%|##########| 199/199 [00:00<00:00, 6832.62it/s]",
      "The `tokenize` method is deprecated, please use `preprocess` instead.",
      "UserWarning: resource_tracker: There appear to be 1 leaked semaphore objects",
      "ValueError: something real",
    ].join("\n");

    const summary = summariseTrainerError(raw);
    expect(summary).not.toMatch(/HF_TOKEN|Loading weights|leaked semaphore|deprecated/);
    expect(summary).toContain("something real");
  });

  it("caps the length, because this renders inside a card", () => {
    const raw = "train.py failed: " + "x".repeat(5_000);
    const summary = summariseTrainerError(raw);

    expect(summary.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(summary).toMatch(/…$/);
  });

  it("falls back to the first line when nothing looks like an error", () => {
    // Better than an empty card: it still names the step that failed.
    const raw = "train.py failed: Command failed: uv run python train.py\nLoading weights: 100%";
    expect(summariseTrainerError(raw)).toContain("train.py failed");
  });

  it("handles an empty or whitespace-only message", () => {
    expect(summariseTrainerError("")).toBeTruthy();
    expect(summariseTrainerError("   \n  ")).toBeTruthy();
  });

  it("strips the command echo, which is noise the reader did not ask for", () => {
    const raw = "train.py failed: Command failed: uv run --extra export python train.py\nOSError: disk full";
    const summary = summariseTrainerError(raw);

    expect(summary).toContain("disk full");
    expect(summary).not.toContain("--extra export");
  });
});
