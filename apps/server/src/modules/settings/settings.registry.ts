import type { SettingKey, SettingValueType } from "@bmp/types";

import { env } from "../../config/env.js";

export interface SettingDefinition {
  type: SettingValueType;
  defaultValue: string | number | boolean;
  label: string;
  group: string;
}

export const SETTING_DEFINITIONS: Record<SettingKey, SettingDefinition> = {
  TENDER_NOTES_AI_ENABLED: {
    type: "boolean",
    defaultValue: env.TENDER_NOTES_AI_ENABLED,
    label: "AI-clean Terms & Notes on tender extraction",
    group: "AI & Extraction",
  },
  AI_ENRICHMENT_ENABLED: {
    type: "boolean",
    defaultValue: env.AI_ENRICHMENT_ENABLED,
    label: "Background BOQ enrichment (classification, rate & HSN suggestions)",
    group: "AI & Extraction",
  },
  OLLAMA_MODEL: {
    type: "string",
    defaultValue: env.OLLAMA_MODEL,
    label: "Ollama model (tender extraction)",
    group: "AI & Extraction",
  },
  OLLAMA_EMBED_MODEL: {
    type: "string",
    defaultValue: env.OLLAMA_EMBED_MODEL,
    label: "Ollama embedding model",
    group: "AI & Extraction",
  },
  OLLAMA_ENRICHMENT_MODEL: {
    type: "string",
    defaultValue: env.OLLAMA_ENRICHMENT_MODEL,
    label: "Ollama model (item/HSN classification)",
    group: "AI & Extraction",
  },
  OLLAMA_BASE_URL: {
    type: "string",
    defaultValue: env.OLLAMA_BASE_URL,
    label: "Ollama base URL",
    group: "AI & Extraction",
  },
  AI_MATCH_THRESHOLD: {
    type: "number",
    defaultValue: env.AI_MATCH_THRESHOLD,
    label: "Minimum cosine similarity to auto-reuse a confirmed match",
    group: "AI & Extraction",
  },
  AI_CONTEXT_FLOOR: {
    type: "number",
    defaultValue: env.AI_CONTEXT_FLOOR,
    label: "Minimum similarity to show a candidate to the model at all",
    group: "AI & Extraction",
  },
  DOCUMENT_MATCH_THRESHOLD: {
    type: "number",
    defaultValue: env.DOCUMENT_MATCH_THRESHOLD,
    label: "Minimum similarity for a document search match",
    group: "AI & Extraction",
  },
  LOCAL_DOCS_SYNC_ENABLED: {
    type: "boolean",
    defaultValue: env.LOCAL_DOCS_SYNC_ENABLED,
    label: "Watch local folder and auto-attach dropped files to tenders",
    group: "Document Sync",
  },
  INCOMING_TENDERS_INGESTION_ENABLED: {
    type: "boolean",
    defaultValue: env.INCOMING_TENDERS_INGESTION_ENABLED,
    label: "Auto-create tenders from dropped files",
    group: "Document Sync",
  },
  DOCUMENT_INDEXING_ENABLED: {
    type: "boolean",
    defaultValue: env.DOCUMENT_INDEXING_ENABLED,
    label: "Index uploaded documents for search",
    group: "Document Sync",
  },
  ASSISTANT_TIMEZONE: {
    type: "string",
    defaultValue: env.ASSISTANT_TIMEZONE,
    label: "Assistant timezone",
    group: "Assistant",
  },
  ACCESS_TOKEN_TTL_MINUTES: {
    type: "number",
    defaultValue: env.ACCESS_TOKEN_TTL_MINUTES,
    label: "Access token lifetime (minutes)",
    group: "Authentication",
  },
  REFRESH_TOKEN_TTL_DAYS: {
    type: "number",
    defaultValue: env.REFRESH_TOKEN_TTL_DAYS,
    label: "Refresh token lifetime (days)",
    group: "Authentication",
  },
  PASSWORD_RESET_TOKEN_TTL_MINUTES: {
    type: "number",
    defaultValue: env.PASSWORD_RESET_TOKEN_TTL_MINUTES,
    label: "Password reset link lifetime (minutes)",
    group: "Authentication",
  },
  EMAIL_VERIFICATION_TOKEN_TTL_HOURS: {
    type: "number",
    defaultValue: env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS,
    label: "Email verification link lifetime (hours)",
    group: "Authentication",
  },
  HSN_SAC_AUTO_REFRESH_ENABLED: {
    type: "boolean",
    defaultValue: true,
    label: "Automatically refresh HSN/SAC codes weekly from CBIC",
    group: "Reference Data",
  },
};
