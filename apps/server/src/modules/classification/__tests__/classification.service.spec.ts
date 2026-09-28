import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveModelDir } from "../classification.embedder.js";
import { ClassificationService } from "../classification.service.js";

const modelDir = resolveModelDir();
const ready = existsSync(path.join(modelDir, "index.json"));
const describeWithModel = ready ? describe : describe.skip;

describeWithModel("ClassificationService (needs a built model + index)", () => {
  const service = new ClassificationService({ modelDir, minConfidence: 0 });

  it("puts the two probe items on the headings this project was started to fix", async () => {
    // These two failed in every earlier approach: the correct class was not even in the top 5 of
    // zero-shot retrieval, and the LLM step then picked the least-bad wrong answer.
    const spring = await service.classify(
      "WASHER TYPE : DISC SPRING MATERIAL : : SPRING STEEL 51CRV4",
    );
    const socket = await service.classify("SOCKET MATERIAL : MILD STEEL, IS:1239");

    expect(spring.headingCode).toBe("7320");
    expect(socket.headingCode).toBe("7307");
  }, 180_000);

  it("gives the same answer for the same text on a second call", async () => {
    // Determinism is why fp32 ships instead of the smaller int8 build. An item's code must not
    // depend on what else happened to be enriched alongside it.
    const first = await service.classify("SELF ADHESSIVE PVC INSULATING TAPE, BLACK, 1100V GRADE");
    const second = await service.classify("SELF ADHESSIVE PVC INSULATING TAPE, BLACK, 1100V GRADE");

    expect(second.headingCode).toBe(first.headingCode);
    expect(second.similarity).toBeCloseTo(first.similarity, 6);
  }, 180_000);

  it("classifies a batch and keeps the input order", async () => {
    const results = await service.classifyMany([
      "WASHER TYPE : DISC SPRING MATERIAL : : SPRING STEEL 51CRV4",
      "SOCKET MATERIAL : MILD STEEL, IS:1239",
    ]);

    expect(results).toHaveLength(2);
    expect(results[0]?.headingCode).toBe("7320");
    expect(results[1]?.headingCode).toBe("7307");
  }, 180_000);

  it("reports a chapter alongside the heading, since the category comes from it", async () => {
    const result = await service.classify("BARREL NIPPLE M.S. GALVANISED 15MM X 51MM LONG");

    expect(result.chapterCode).toBe(result.headingCode?.slice(0, 2));
  }, 180_000);

  it("abstains instead of guessing when nothing matches well", async () => {
    const strict = new ClassificationService({ modelDir, minConfidence: 0.99 });
    const result = await strict.classify("qqqq zzzz wwww");

    expect(result.abstained).toBe(true);
    expect(result.headingCode).toBeNull();
  }, 180_000);

  it("loads the model once and reuses it across calls", async () => {
    const started = Date.now();
    await service.classify("GALVANISED STEEL ELBOW 25MM");
    const warm = Date.now() - started;

    expect(warm).toBeLessThan(5_000);
  }, 180_000);
});
