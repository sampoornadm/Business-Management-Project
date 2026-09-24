import { Queue } from "bullmq";

import { redis } from "../redis/client.js";

export type EmailJobPayload =
  | { type: "invite"; to: string; firstName: string; setPasswordUrl: string }
  | { type: "verification"; to: string; firstName: string; verifyUrl: string }
  | { type: "password-reset"; to: string; firstName: string; resetUrl: string }
  | {
      type: "tender-assigned";
      to: string;
      firstName: string;
      tenderNumber: string;
      tenderTitle: string;
      tenderUrl: string;
    }
  | {
      type: "tender-deadline-reminder";
      to: string;
      firstName: string;
      tenderNumber: string;
      tenderTitle: string;
      // Precomputed by the worker ("1 day", "today", "1 hour", ...) — the day-count and
      // hour-count thresholds need different label shapes, so the label is built once where
      // the threshold is decided rather than reconstructed here from a number.
      timeLabel: string;
      tenderUrl: string;
    }
  | { type: "rfq"; to: string; rfqTitle: string; bodyText: string };

export const EMAIL_QUEUE_NAME = "email";

export const emailQueue = new Queue<EmailJobPayload, void, "send-email">(EMAIL_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const TENDER_REMINDER_QUEUE_NAME = "tender-reminders";

export type TenderReminderJobName = "check-deadlines" | "check-hourly-deadlines";

export const tenderReminderQueue = new Queue<Record<string, never>, void, TenderReminderJobName>(
  TENDER_REMINDER_QUEUE_NAME,
  { connection: redis },
);

export interface AiEnrichmentJobPayload {
  boqId: string;
  businessId: string;
}

export const AI_ENRICHMENT_QUEUE_NAME = "ai-enrichment";

export const aiEnrichmentQueue = new Queue<AiEnrichmentJobPayload, void, "enrich-boq">(
  AI_ENRICHMENT_QUEUE_NAME,
  {
    connection: redis,
    // Only 2 attempts: Ollama being down is handled inside the worker as a clean no-op,
    // so a retry here only ever covers a transient mid-run failure.
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  },
);

export interface DocumentIndexingJobPayload {
  attachmentId: string;
}

export const DOCUMENT_INDEXING_QUEUE_NAME = "document-indexing";

export const documentIndexingQueue = new Queue<DocumentIndexingJobPayload, void, "index-document">(
  DOCUMENT_INDEXING_QUEUE_NAME,
  {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: 50,
      removeOnFail: 100,
    },
  },
);

export const HSN_SAC_REFRESH_QUEUE_NAME = "hsn-sac-refresh";

export const hsnSacRefreshQueue = new Queue<Record<string, never>, void, "refresh">(
  HSN_SAC_REFRESH_QUEUE_NAME,
  { connection: redis },
);
