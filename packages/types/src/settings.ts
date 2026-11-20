export const SETTING_KEYS = [
  "TENDER_NOTES_AI_ENABLED",
  "AI_ENRICHMENT_ENABLED",
  "OLLAMA_MODEL",
  "OLLAMA_EMBED_MODEL",
  "OLLAMA_ENRICHMENT_MODEL",
  "OLLAMA_BASE_URL",
  "AI_MATCH_THRESHOLD",
  "AI_CONTEXT_FLOOR",
  "HSN_REUSE_THRESHOLD",
  "CLASSIFIER_MIN_CONFIDENCE",
  "DOCUMENT_MATCH_THRESHOLD",
  "LOCAL_DOCS_SYNC_ENABLED",
  "INCOMING_TENDERS_INGESTION_ENABLED",
  "DOCUMENT_INDEXING_ENABLED",
  "ASSISTANT_TIMEZONE",
  "ACCESS_TOKEN_TTL_MINUTES",
  "REFRESH_TOKEN_TTL_DAYS",
  "PASSWORD_RESET_TOKEN_TTL_MINUTES",
  "EMAIL_VERIFICATION_TOKEN_TTL_HOURS",
  "HSN_SAC_AUTO_REFRESH_ENABLED",
  "PROMPT_RFQ_QUOTE_PASTE",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

// "prompt" is a string edited as a multi-line template; see requiredMarkers.
export type SettingValueType = "string" | "number" | "boolean" | "prompt";

export interface SettingDto {
  key: SettingKey;
  type: SettingValueType;
  label: string;
  group: string;
  value: string | number | boolean;
  defaultValue: string | number | boolean;
  /** Prompt settings only: `{{name}}` markers a saved value must keep. Empty otherwise. */
  requiredMarkers: string[];
  isOverridden: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}
