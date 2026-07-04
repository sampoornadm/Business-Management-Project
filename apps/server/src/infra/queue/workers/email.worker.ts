import { Worker } from "bullmq";

import { env } from "../../../config/env.js";
import { logger } from "../../../shared/logger/logger.js";
import { mailer } from "../../mailer/mailer.js";
import {
  buildInviteEmail,
  buildPasswordResetEmail,
  buildTenderAssignedEmail,
  buildTenderDeadlineReminderEmail,
  buildVerificationEmail,
  type EmailContent,
} from "../../mailer/templates.js";
import { redis } from "../../redis/client.js";
import { EMAIL_QUEUE_NAME, type EmailJobPayload } from "../queues.js";

function buildContent(payload: EmailJobPayload): EmailContent {
  switch (payload.type) {
    case "invite":
      return buildInviteEmail(payload);
    case "verification":
      return buildVerificationEmail(payload);
    case "password-reset":
      return buildPasswordResetEmail(payload);
    case "tender-assigned":
      return buildTenderAssignedEmail(payload);
    case "tender-deadline-reminder":
      return buildTenderDeadlineReminderEmail(payload);
  }
}

async function sendEmailJob(payload: EmailJobPayload): Promise<void> {
  const content = buildContent(payload);

  await mailer.sendMail({
    from: env.SMTP_FROM,
    to: payload.to,
    subject: content.subject,
    html: content.html,
  });
}

export function startEmailWorker(): Worker<EmailJobPayload, void, "send-email"> {
  const worker = new Worker<EmailJobPayload, void, "send-email">(
    EMAIL_QUEUE_NAME,
    async (job) => {
      await sendEmailJob(job.data);
    },
    { connection: redis },
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, type: job.data.type }, "Email job completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Email job failed");
  });

  return worker;
}
