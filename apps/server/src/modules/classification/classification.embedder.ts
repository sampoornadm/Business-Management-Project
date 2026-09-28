import path from "node:path";
import { fileURLToPath } from "node:url";

import { env as transformersEnv, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

/**
 * Runs the locally-trained HSN classifier's encoder in this process.
 *
 * Transformers.js rather than a hand-rolled ONNX call, for one reason: it brings the model's own
 * tokenizer. Re-implementing WordPiece in TypeScript is the single most likely way to end up with
 * vectors that are subtly wrong — they would still be 384 finite numbers that embed and rank
 * without erroring, and the only symptom would be worse answers nobody could trace back here.
 * `classification.embedder.spec.ts` asserts the vectors match the ones PyTorch produced.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

/** e5 was trained with these prefixes and its accuracy drops measurably without them. */
export const QUERY_PREFIX = "query: ";
export const PASSAGE_PREFIX = "passage: ";

export interface Embedder {
  /** L2-normalised vectors, one per input, in input order. */
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly dimensions: number;
}

export function resolveModelDir(): string {
  return process.env.CLASSIFIER_MODEL_DIR ?? path.join(REPO_ROOT, "ml/models/current");
}

export async function createEmbedder(modelDir: string = resolveModelDir()): Promise<Embedder> {
  // Transformers.js resolves a model as <localModelPath>/<name>, and must never reach the Hub:
  // this model is ours and there is nothing there to fall back to.
  transformersEnv.allowRemoteModels = false;
  transformersEnv.localModelPath = path.dirname(modelDir);

  const extractor: FeatureExtractionPipeline = await pipeline(
    "feature-extraction",
    path.basename(modelDir),
    // fp32, not the 118 MB q8 build, and the reason is determinism rather than the 1.3 point of
    // accuracy. Dynamic int8 computes activation scales per batch, so an item's vector shifts
    // depending on what happened to be embedded alongside it — measured at cosine 0.985-0.990
    // between the same text alone and in a batch, in Python and Node alike. The median gap between
    // the top two candidates is 0.0225, so that wobble is easily enough to change which HSN code an
    // item gets between two runs over the same data. fp32 is bit-identical either way.
    { dtype: "fp32" },
  );

  let dimensions = 0;

  return {
    get dimensions() {
      return dimensions;
    },
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];

      // mean + normalize reproduce the 1_Pooling and 2_Normalize stages of the saved model; the
      // ONNX graph is the bare encoder, so skipping these gives token-level output, not an embedding.
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      const [rows, width] = output.dims as [number, number];
      dimensions = width;

      const flat = output.data as Float32Array;
      return Array.from({ length: rows }, (_, row) =>
        flat.slice(row * width, (row + 1) * width),
      );
    },
  };
}
