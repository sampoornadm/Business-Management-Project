import { readFile } from "node:fs/promises";
import path from "node:path";

import { logger } from "../../shared/logger/logger.js";

import {
  createEmbedder,
  QUERY_PREFIX,
  resolveModelDir,
  type Embedder,
} from "./classification.embedder.js";
import {
  classifyAgainst,
  type Classification,
  type IndexEntry,
} from "./classification.scoring.js";

/**
 * Classifies a procurement line into an HSN heading, using the locally-trained model.
 *
 * The heading IS the HSN code, and its chapter IS the item's category, so one forward pass answers
 * both questions that previously took an ANN lookup plus an LLM call each. Measured on real
 * purchase-order lines that pair scored 0 correct out of 22; this scores 47.4% on held-out items.
 *
 * Everything is lazy and cached: the first call pays for loading 470 MB of weights and a 19 MB
 * vector index, and every call after that is arithmetic over memory.
 */

export interface ClassificationServiceOptions {
  modelDir?: string;
  /**
   * Below this, the item is left unclassified rather than guessed at. The app's standing rule is
   * that an uncertain AI value never writes itself into a real field.
   */
  minConfidence: number;
}

interface IndexFile {
  builtAt: string;
  dimensions: number;
  headings: string[];
  /** Per-entry provenance; classification weights a curated term above tariff prose. */
  sources?: string[];
  vectors: string;
}

export class ClassificationService {
  private readonly modelDir: string;
  private readonly minConfidence: number;
  private loading: Promise<{ embedder: Embedder; index: IndexEntry[] }> | null = null;

  constructor(options: ClassificationServiceOptions) {
    this.modelDir = options.modelDir ?? resolveModelDir();
    this.minConfidence = options.minConfidence;
  }

  /** True once a model and its index exist on disk — both are built by ml/train, not shipped. */
  async isAvailable(): Promise<boolean> {
    try {
      await readFile(path.join(this.modelDir, "index.json"), "utf8");
      return true;
    } catch {
      return false;
    }
  }

  async classify(text: string): Promise<Classification> {
    const [result] = await this.classifyMany([text]);
    return result!;
  }

  async classifyMany(texts: string[]): Promise<Classification[]> {
    if (texts.length === 0) return [];

    const { embedder, index } = await this.load();
    const vectors = await embedder.embed(texts.map((text) => QUERY_PREFIX + text));

    return vectors.map((vector) =>
      classifyAgainst(vector, index, { minConfidence: this.minConfidence }),
    );
  }

  /** One in-flight load, shared: concurrent enrichment jobs must not each read 470 MB of weights. */
  private load(): Promise<{ embedder: Embedder; index: IndexEntry[] }> {
    this.loading ??= this.loadOnce().catch((error) => {
      this.loading = null; // a failed load must not poison every later call
      throw error;
    });
    return this.loading;
  }

  private async loadOnce(): Promise<{ embedder: Embedder; index: IndexEntry[] }> {
    const started = Date.now();
    const [embedder, index] = await Promise.all([
      createEmbedder(this.modelDir),
      this.readIndex(),
    ]);

    logger.info(
      { texts: index.length, ms: Date.now() - started, modelDir: this.modelDir },
      "Loaded the HSN classification model",
    );
    return { embedder, index };
  }

  private async readIndex(): Promise<IndexEntry[]> {
    const file = path.join(this.modelDir, "index.json");
    const parsed = JSON.parse(await readFile(file, "utf8")) as IndexFile;

    // Little-endian float32, row-major, one row per indexed text. Each vector is copied into its
    // own array rather than viewed over the decoded blob, which would keep all 19 MB alive per row.
    const bytes = Buffer.from(parsed.vectors, "base64");
    const { dimensions, headings } = parsed;
    const sources = parsed.sources ?? [];

    if (bytes.byteLength !== headings.length * dimensions * 4) {
      throw new Error(
        `Index file is inconsistent: ${headings.length} texts x ${dimensions} dims does not ` +
          `match ${bytes.byteLength} bytes. Re-run ml/train/build_index.py.`,
      );
    }

    return headings.map((heading, row) => {
      const vector = new Float32Array(dimensions);
      for (let i = 0; i < dimensions; i += 1) {
        vector[i] = bytes.readFloatLE((row * dimensions + i) * 4);
      }
      // An index built before sources were recorded falls back to "tariff", the conservative
      // reading: it under-trusts a curated term rather than over-trusting generic prose.
      return { heading, vector, source: sources[row] ?? "tariff" };
    });
  }
}
