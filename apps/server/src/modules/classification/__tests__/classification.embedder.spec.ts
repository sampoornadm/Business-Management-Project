import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { createEmbedder, resolveModelDir } from "../classification.embedder.js";

const modelDir = resolveModelDir();
const fixturePath = new URL("../../../../../../ml/data/eval/parity-fixture.json", import.meta.url);

// The model is gitignored and rebuilt by ml/train, so a fresh clone or CI has no weights to load.
// Skipping is correct there; failing would just mean "you have not trained yet".
const describeWithModel = existsSync(modelDir) ? describe : describe.skip;

describeWithModel("classification embedder (needs ml/models/current)", () => {
  it("reproduces the vectors PyTorch produced for the same text", async () => {
    // The whole point of this test. Node tokenises with a different implementation than Python and
    // pools the output itself; if either diverges the result is still 384 finite numbers that embed
    // and rank without complaining, so a mismatch is invisible except as worse answers.
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      tolerance_cosine: number;
      probes: { text: string; vector: number[] }[];
    };

    const embedder = await createEmbedder(modelDir);
    const vectors = await embedder.embed(fixture.probes.map((p) => p.text));

    expect(vectors).toHaveLength(fixture.probes.length);
    for (const [index, probe] of fixture.probes.entries()) {
      const got = vectors[index]!;
      expect(got).toHaveLength(probe.vector.length);
      const cosine = probe.vector.reduce((sum, want, i) => sum + want * got[i]!, 0);
      expect(cosine).toBeGreaterThan(fixture.tolerance_cosine);
    }
  }, 120_000);

  it("returns unit vectors, so cosine is a plain dot product downstream", async () => {
    const embedder = await createEmbedder(modelDir);
    const [vector] = await embedder.embed(["query: GALVANISED STEEL BARREL NIPPLE 15MM"]);

    const norm = Math.sqrt(vector!.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 4);
  }, 120_000);

  it("embeds a batch in one call and keeps the input order", async () => {
    const embedder = await createEmbedder(modelDir);
    const texts = ["query: disc spring washer", "query: PVC insulating tape", "query: barrel nipple"];

    const batch = await embedder.embed(texts);
    const [single] = await embedder.embed([texts[1]!]);

    const cosine = single!.reduce((sum, v, i) => sum + v * batch[1]![i]!, 0);
    expect(cosine).toBeGreaterThan(0.999);
  }, 120_000);
});
