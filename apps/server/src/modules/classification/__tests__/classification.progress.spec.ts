import { describe, expect, it } from "vitest";

import { parseProgressLine } from "../classification.progress.js";

describe("parseProgressLine", () => {
  it("reads a training step line", () => {
    // train.py prints this every 50 steps. Without it the card says "Training the model" for
    // minutes with nothing to distinguish progress from a hang — which is exactly how a stuck run
    // went unnoticed for seven hours.
    expect(parseProgressLine("  epoch 1/1  step 50/436  loss 0.1234")).toEqual({
      label: "Training — epoch 1/1, step 50 of 436 (loss 0.1234)",
      fraction: 50 / 436,
    });
  });

  it("reads the batch-count line printed at the start of an epoch", () => {
    expect(parseProgressLine("  epoch 2: 109 batches in 0.0s")).toEqual({
      label: "Training — starting epoch 2 (109 batches)",
      fraction: null,
    });
  });

  it("reads the embedding line from the index build", () => {
    expect(parseProgressLine("embedding 9490 texts...")).toEqual({
      label: "Embedding 9,490 texts",
      fraction: null,
    });
  });

  it("reads the frozen-baseline score, which is the first real number a run produces", () => {
    expect(parseProgressLine("  before fine-tuning: 61/76 = 80.3%")).toEqual({
      label: "Scored the current model: 80.3%",
      fraction: null,
    });
  });

  it("ignores lines that carry no progress", () => {
    for (const line of [
      "",
      "warning: VIRTUAL_ENV does not match",
      "Loading weights: 100%|##########| 199/199",
      "some unrelated chatter",
    ]) {
      expect(parseProgressLine(line)).toBeNull();
    }
  });

  it("does not mistake a loss value for a step count", () => {
    expect(parseProgressLine("loss 0.5/1.0")).toBeNull();
  });
});
