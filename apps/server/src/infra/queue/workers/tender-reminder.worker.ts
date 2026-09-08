import { Worker } from "bullmq";

import { notificationsService } from "../../../modules/notifications/notifications.module.js";
import { logger } from "../../../shared/logger/logger.js";
import { EmailService } from "../../mailer/email.service.js";
import { listAllBusinessIds } from "../../prisma/business-ids.js";
import { prisma } from "../../prisma/client.js";
import { redis } from "../../redis/client.js";
import { TENDER_REMINDER_QUEUE_NAME, type TenderReminderJobName } from "../queues.js";

// 0 = "morning of" (fires in the same daily run as 1/3/7, via the same day-window query below).
const REMINDER_THRESHOLD_DAYS = [0, 1, 3, 7];
const REMINDER_WINDOW_HOURS = 1;

// A tender stops needing deadline reminders once it's no longer waiting to be submitted —
// SUBMITTED included deliberately (not just the generally-terminal WON/LOST/CANCELLED): once
// the bid is in, a reminder about its own deadline is noise, not a nudge.
const NON_REMINDABLE_STATUSES = ["SUBMITTED", "WON", "LOST", "CANCELLED"] as const;

type TenderForReminder = {
  id: string;
  tenderNumber: string;
  title: string;
  createdBy: { id: string; firstName: string; email: string };
  assignees: { user: { id: string; firstName: string; email: string } }[];
};

function dayBounds(daysFromNow: number): { start: Date; end: Date } {
  const target = new Date();
  target.setDate(target.getDate() + daysFromNow);
  const start = new Date(target);
  start.setHours(0, 0, 0, 0);
  const end = new Date(target);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function dayTimeLabel(daysRemaining: number): string {
  if (daysRemaining === 0) return "today";
  return daysRemaining === 1 ? "1 day" : `${daysRemaining} days`;
}

function deadlineTitle(daysRemaining: number, timeLabel: string): string {
  return daysRemaining === 0 ? "Submission deadline is today" : `Submission deadline in ${timeLabel}`;
}

/**
 * Sends the reminder (in-app notification + email, to the tender's creator and every assignee)
 * for one tender at one threshold, if it hasn't already gone out for that exact threshold.
 * Shared by both the day-bucketed and the hour-precise checks below — same recipients, same two
 * channels, only the threshold identity (for dedup) and display label differ.
 */
async function notifyTenderDeadline(
  tender: TenderForReminder,
  businessId: string,
  thresholdMetadata: Record<string, number>,
  title: string,
  timeLabel: string,
): Promise<void> {
  const alreadySent = await notificationsService.alreadyNotified(
    "Tender",
    tender.id,
    "TENDER_DEADLINE_REMINDER",
    thresholdMetadata,
    businessId,
  );
  if (alreadySent) return;

  const recipients = new Map<string, { id: string; firstName: string; email: string }>();
  recipients.set(tender.createdBy.id, tender.createdBy);
  for (const assignee of tender.assignees) {
    recipients.set(assignee.user.id, assignee.user);
  }

  await notificationsService.createMany([...recipients.keys()], {
    businessId,
    type: "TENDER_DEADLINE_REMINDER",
    title,
    body: `${tender.tenderNumber} — ${tender.title}`,
    entityType: "Tender",
    entityId: tender.id,
    metadata: thresholdMetadata,
  });

  const emailService = new EmailService();
  for (const user of recipients.values()) {
    await emailService.queueTenderDeadlineReminderEmail({
      to: user.email,
      firstName: user.firstName,
      tenderId: tender.id,
      tenderNumber: tender.tenderNumber,
      tenderTitle: tender.title,
      timeLabel,
    });
  }
}

/**
 * Checks upcoming submission deadlines for a single business's tenders and queues reminder
 * notifications/emails to their assignees. Exported (rather than kept module-private) so tests
 * can exercise it directly without going through the BullMQ worker/job plumbing.
 */
export async function checkDeadlinesForBusiness(businessId: string): Promise<void> {
  for (const daysRemaining of REMINDER_THRESHOLD_DAYS) {
    const { start, end } = dayBounds(daysRemaining);

    const tenders = await prisma.tender.findMany({
      where: {
        businessId,
        submissionDate: { gte: start, lte: end },
        status: { notIn: [...NON_REMINDABLE_STATUSES] },
      },
      include: {
        assignees: { include: { user: true } },
        createdBy: true,
      },
    });

    const timeLabel = dayTimeLabel(daysRemaining);
    for (const tender of tenders) {
      await notifyTenderDeadline(
        tender,
        businessId,
        { thresholdDays: daysRemaining },
        deadlineTitle(daysRemaining, timeLabel),
        timeLabel,
      );
    }
  }
}

/**
 * Checks for tenders whose submission deadline falls within the next hour — genuinely time-of-day
 * precise, unlike the day-bucketed check above, so it needs its own more-frequent job (see
 * `worker.ts`'s every-15-minutes schedule for `check-hourly-deadlines`) rather than piggybacking on
 * the once-daily run. Dedup via `alreadyNotified` means a tender whose window this catches on one
 * 15-minute run won't fire again on the next.
 */
export async function checkHourlyDeadlinesForBusiness(businessId: string): Promise<void> {
  const now = new Date();
  const until = new Date(now.getTime() + REMINDER_WINDOW_HOURS * 60 * 60 * 1000);

  const tenders = await prisma.tender.findMany({
    where: {
      businessId,
      submissionDate: { gte: now, lte: until },
      status: { notIn: [...NON_REMINDABLE_STATUSES] },
    },
    include: {
      assignees: { include: { user: true } },
      createdBy: true,
    },
  });

  const timeLabel = "1 hour";
  for (const tender of tenders) {
    await notifyTenderDeadline(
      tender,
      businessId,
      { thresholdHours: REMINDER_WINDOW_HOURS },
      `Submission deadline in ${timeLabel}`,
      timeLabel,
    );
  }
}

/**
 * Runs the deadline check once per business. `Tender` is a business-scoped model (see
 * scoped-client.ts's `SCOPED_MODELS`), so a single global query across every business's tenders
 * is refused at query time — `Business` itself isn't scoped (it's the tenant list), so listing
 * all business ids and looping `checkDeadlinesForBusiness` per tenant is the correct shape.
 */
async function checkDeadlines(): Promise<void> {
  const businessIds = await listAllBusinessIds(prisma);
  for (const businessId of businessIds) {
    await checkDeadlinesForBusiness(businessId);
  }
}

async function checkHourlyDeadlines(): Promise<void> {
  const businessIds = await listAllBusinessIds(prisma);
  for (const businessId of businessIds) {
    await checkHourlyDeadlinesForBusiness(businessId);
  }
}

export function startTenderReminderWorker(): Worker<Record<string, never>, void, TenderReminderJobName> {
  const worker = new Worker<Record<string, never>, void, TenderReminderJobName>(
    TENDER_REMINDER_QUEUE_NAME,
    async (job) => {
      if (job.name === "check-hourly-deadlines") {
        await checkHourlyDeadlines();
      } else {
        await checkDeadlines();
      }
    },
    { connection: redis },
  );

  worker.on("completed", (job) => {
    logger.info(`Tender deadline check completed (${job.name})`);
  });

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, err }, "Tender deadline check failed");
  });

  return worker;
}
