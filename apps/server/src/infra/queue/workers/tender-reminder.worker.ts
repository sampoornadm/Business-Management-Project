import { Worker } from "bullmq";

import { notificationsService } from "../../../modules/notifications/notifications.module.js";
import { logger } from "../../../shared/logger/logger.js";
import { EmailService } from "../../mailer/email.service.js";
import { prisma } from "../../prisma/client.js";
import { redis } from "../../redis/client.js";
import { TENDER_REMINDER_QUEUE_NAME } from "../queues.js";

const REMINDER_THRESHOLD_DAYS = [1, 3, 7];
const TERMINAL_STATUSES = ["WON", "LOST", "CANCELLED"] as const;

function dayBounds(daysFromNow: number): { start: Date; end: Date } {
  const target = new Date();
  target.setDate(target.getDate() + daysFromNow);
  const start = new Date(target);
  start.setHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function checkDeadlines(): Promise<void> {
  const emailService = new EmailService();

  for (const daysRemaining of REMINDER_THRESHOLD_DAYS) {
    const { start, end } = dayBounds(daysRemaining);

    const tenders = await prisma.tender.findMany({
      where: {
        submissionDate: { gte: start, lte: end },
        status: { notIn: [...TERMINAL_STATUSES] },
      },
      include: {
        assignees: { include: { user: true } },
        createdBy: true,
      },
    });

    for (const tender of tenders) {
      const alreadySent = await notificationsService.alreadyNotified(
        "Tender",
        tender.id,
        "TENDER_DEADLINE_REMINDER",
        { thresholdDays: daysRemaining },
      );
      if (alreadySent) continue;

      const recipients = new Map<string, { id: string; firstName: string; email: string }>();
      recipients.set(tender.createdBy.id, tender.createdBy);
      for (const assignee of tender.assignees) {
        recipients.set(assignee.user.id, assignee.user);
      }

      const dayLabel = daysRemaining === 1 ? "1 day" : `${daysRemaining} days`;
      await notificationsService.createMany([...recipients.keys()], {
        type: "TENDER_DEADLINE_REMINDER",
        title: `Submission deadline in ${dayLabel}`,
        body: `${tender.tenderNumber} — ${tender.title}`,
        entityType: "Tender",
        entityId: tender.id,
        metadata: { thresholdDays: daysRemaining },
      });

      for (const user of recipients.values()) {
        await emailService.queueTenderDeadlineReminderEmail({
          to: user.email,
          firstName: user.firstName,
          tenderId: tender.id,
          tenderNumber: tender.tenderNumber,
          tenderTitle: tender.title,
          daysRemaining,
        });
      }
    }
  }
}

export function startTenderReminderWorker(): Worker<Record<string, never>, void, "check-deadlines"> {
  const worker = new Worker<Record<string, never>, void, "check-deadlines">(
    TENDER_REMINDER_QUEUE_NAME,
    async () => {
      await checkDeadlines();
    },
    { connection: redis },
  );

  worker.on("completed", () => {
    logger.info("Tender deadline check completed");
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Tender deadline check failed");
  });

  return worker;
}
