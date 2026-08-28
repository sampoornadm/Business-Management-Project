import { z } from "zod";

// z.coerce.boolean() is a footgun for env strings: Boolean("false") is `true`
// in JS, so that coercion can never actually turn a flag off via an env var
// set to the literal string "false". This parses the string explicitly
// instead.
export function booleanEnv(defaultValue: "true" | "false") {
  return z
    .string()
    .default(defaultValue)
    .transform((value) => value === "true");
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  SERVER_PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_PATH: z.string().default("/api/v1"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  WEB_APP_URL: z.string().default("http://localhost:3000"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  ACCESS_TOKEN_SECRET: z.string().min(16, "ACCESS_TOKEN_SECRET must be at least 16 characters"),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_TOKEN_COOKIE_NAME: z.string().default("refreshToken"),

  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  EMAIL_VERIFICATION_TOKEN_TTL_HOURS: z.coerce.number().int().positive().default(48),

  S3_ENDPOINT: z.string().min(1, "S3_ENDPOINT is required"),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY_ID: z.string().min(1, "S3_ACCESS_KEY_ID is required"),
  S3_SECRET_ACCESS_KEY: z.string().min(1, "S3_SECRET_ACCESS_KEY is required"),
  S3_BUCKET: z.string().min(1, "S3_BUCKET is required"),
  S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),

  SMTP_HOST: z.string().min(1, "SMTP_HOST is required"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_FROM: z.string().default("Business Management Platform <no-reply@bmp.local>"),

  SEED_USER_PASSWORD: z.string().optional(),

  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1:8b"),

  // Whether the tender Note/NIT/ITT "Terms & Notes" section is extracted by the LLM (on) or
  // a deterministic regex parser (off). On by default: the LLM handles messy, letterhead-
  // interleaved prose far better. Falls back to regex automatically if the LLM is unavailable.
  TENDER_NOTES_AI_ENABLED: booleanEnv("true"),

  // Opt-in: enriches committed BOQ items (classification, normalized name, historical
  // rate suggestion) via a background job. Off by default — every BOQ path works
  // identically with this false or with Ollama simply not running.
  AI_ENRICHMENT_ENABLED: booleanEnv("false"),
  OLLAMA_EMBED_MODEL: z.string().default("bge-m3"),
  OLLAMA_ENRICHMENT_MODEL: z.string().default("qwen3:4b"),
  // Cosine similarity a HistoricalRate match must clear before its rate can be suggested
  // (it must also pass an identical-numeric-spec and matching-unit check — see
  // boq-enrichment.service.ts). Calibrated against bge-m3, whose cosine range is compressed:
  // the same item with only whitespace differing measures 0.989, but "XLPE Cable 4C x16" vs
  // "…x1.6" — a 10x spec difference and a completely different rate — still measures 0.948.
  // 0.95 would hand an estimator that wrong rate; 0.98 keeps this to near-exact restatements.
  // Re-measure if you change OLLAMA_EMBED_MODEL — this number is model-specific.
  AI_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.98),
  // Retrieval floor: candidates below this aren't even shown to the LLM. Measured with
  // bge-m3: unrelated trades score 0.31-0.38, same-trade items 0.84+.
  AI_CONTEXT_FLOOR: z.coerce.number().min(0).max(1).default(0.75),

  // Opt-in: watches a local folder tree and auto-imports dropped files as
  // tender documents. Off by default so this is a no-op on any machine that
  // doesn't run the worker on the same filesystem as the watched folder (see
  // apps/server/src/modules/tenders/local-docs/).
  LOCAL_DOCS_SYNC_ENABLED: booleanEnv("false"),
  BUSINESSES_ROOT_DIR: z.string().default("~/BMP-Businesses"),

  // Separate opt-in from LOCAL_DOCS_SYNC_ENABLED above: that flag only attaches files
  // onto an EXISTING tender, while this one lets dropped files auto-create real
  // Tender/Organization/Boq rows with zero human review. An environment that already
  // has LOCAL_DOCS_SYNC_ENABLED=true for the former must not silently gain the latter.
  INCOMING_TENDERS_INGESTION_ENABLED: booleanEnv("false"),

  // Opt-in: extracts text and embeds every tender-document Attachment in the background, so it
  // becomes searchable via /search and /assistant. Off by default — same convention as
  // AI_ENRICHMENT_ENABLED (extraction/embedding costs CPU on every upload otherwise).
  DOCUMENT_INDEXING_ENABLED: booleanEnv("false"),
  // Cosine similarity a document's content embedding must clear to appear as a content match in
  // search. Unmeasured placeholder — unlike AI_MATCH_THRESHOLD (calibrated against real BOQ
  // items), no real indexed documents exist yet to measure against. Set above bge-m3's documented
  // unrelated-pair noise ceiling (0.843-0.860, see CLAUDE.md) rather than below it: 0.5 let nearly
  // every embedded document through as a "match". Re-measure once real indexed documents exist,
  // same way AI_MATCH_THRESHOLD was measured against bge-m3 rather than guessed.
  DOCUMENT_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.9),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${formatted}`);
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
