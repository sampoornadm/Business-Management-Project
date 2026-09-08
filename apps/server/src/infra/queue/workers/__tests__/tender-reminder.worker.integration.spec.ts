import { randomUUID } from "node:crypto";

import { prisma } from "@bmp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkDeadlinesForBusiness, checkHourlyDeadlinesForBusiness } from "../tender-reminder.worker.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test, migrated (`pnpm db:migrate` against
 * the test database). Run via `pnpm --filter @bmp/server test` after `docker compose up`.
 *
 * `checkDeadlinesForBusiness` directly imports the app's singletons (guarded `prisma`,
 * `notificationsService`) rather than being constructor-injected like a module's repository, so
 * this is a narrow integration test against the real DB rather than a fake-repository unit test —
 * consistent with how this codebase already tests worker/cross-cutting behavior it can't fake
 * (e.g. `tenders.integration.spec.ts`'s "does not return another business's tenders" case).
 *
 * This worker used to query `prisma.tender.findMany` with no `businessId` in its `where` clause at
 * all (a real bug caught by the business-scope guard, not by any test — there was no test file for
 * this worker before this one). The regression this guards against: a tender's deadline reminder
 * must only ever be computed — and notified — against its own business, never leak across
 * businesses, and the query itself must stay scoped (an unscoped regression would throw via the
 * guard, not just misbehave).
 */
describe("checkDeadlinesForBusiness (integration)", () => {
  let userAId: string;
  let userBId: string;
  let organizationId: string;
  let businessAId: string;
  let businessBId: string;
  let tenderAId: string;
  let tenderBId: string;

  function submissionDateDaysFromNow(days: number): Date {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(12, 0, 0, 0);
    return date;
  }

  beforeAll(async () => {
    const userA = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `reminder-a-${randomUUID()}@example.com`,
        passwordHash: "not-used",
        firstName: "Alice",
        lastName: "BusinessA",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userAId = userA.id;

    const userB = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `reminder-b-${randomUUID()}@example.com`,
        passwordHash: "not-used",
        firstName: "Bob",
        lastName: "BusinessB",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userBId = userB.id;

    const businessA = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Reminder Business A ${randomUUID()}`,
        code: `RBA${randomUUID().slice(0, 8)}`,
      },
    });
    const businessB = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Reminder Business B ${randomUUID()}`,
        code: `RBB${randomUUID().slice(0, 8)}`,
      },
    });
    businessAId = businessA.id;
    businessBId = businessB.id;

    const organization = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Reminder Client ${randomUUID()}`,
        type: "PRIVATE",
        createdById: userAId,
      },
    });
    organizationId = organization.id;

    // Both tenders fall due 3 days from now — REMINDER_THRESHOLD_DAYS includes 3 — one per
    // business, each created by (and thus notifiable to) a different business's user.
    const tenderA = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: businessAId,
        tenderNumber: `TND-REM-A-${randomUUID().slice(0, 8)}`,
        title: "Business A deadline tender",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        submissionDate: submissionDateDaysFromNow(3),
        createdById: userAId,
      },
    });
    tenderAId = tenderA.id;

    const tenderB = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId: businessBId,
        tenderNumber: `TND-REM-B-${randomUUID().slice(0, 8)}`,
        title: "Business B deadline tender",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        submissionDate: submissionDateDaysFromNow(3),
        createdById: userBId,
      },
    });
    tenderBId = tenderB.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { entityId: { in: [tenderAId, tenderBId] } } });
    await prisma.tender.deleteMany({ where: { id: { in: [tenderAId, tenderBId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.business.deleteMany({ where: { id: { in: [businessAId, businessBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userAId, userBId] } } });
    await prisma.$disconnect();
  });

  it("scopes the reminder check to one business, without notifying another business's tender", async () => {
    await checkDeadlinesForBusiness(businessAId);

    const notificationsForA = await prisma.notification.findMany({
      where: { entityType: "Tender", entityId: tenderAId, type: "TENDER_DEADLINE_REMINDER" },
    });
    expect(notificationsForA).toHaveLength(1);
    expect(notificationsForA[0]!.userId).toBe(userAId);

    const notificationsForB = await prisma.notification.findMany({
      where: { entityType: "Tender", entityId: tenderBId, type: "TENDER_DEADLINE_REMINDER" },
    });
    expect(notificationsForB).toHaveLength(0);
  });

  it("notifies business B's tender only once that business's check runs", async () => {
    await checkDeadlinesForBusiness(businessBId);

    const notificationsForB = await prisma.notification.findMany({
      where: { entityType: "Tender", entityId: tenderBId, type: "TENDER_DEADLINE_REMINDER" },
    });
    expect(notificationsForB).toHaveLength(1);
    expect(notificationsForB[0]!.userId).toBe(userBId);
  });
});

describe("checkDeadlinesForBusiness — SUBMITTED tenders and the 'morning of' threshold (integration)", () => {
  let userId: string;
  let organizationId: string;
  let businessId: string;
  let draftTenderId: string;
  let submittedTenderId: string;

  function submissionDateHoursFromNow(hours: number): Date {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `reminder-submitted-${randomUUID()}@example.com`,
        passwordHash: "not-used",
        firstName: "Carol",
        lastName: "Estimator",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;

    const business = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Reminder Submitted Business ${randomUUID()}`,
        code: `RSB${randomUUID().slice(0, 8)}`,
      },
    });
    businessId = business.id;

    const organization = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Reminder Submitted Client ${randomUUID()}`,
        type: "PRIVATE",
        createdById: userId,
      },
    });
    organizationId = organization.id;

    // Both due "today" (well within the same calendar day, so the 0-day threshold's dayBounds
    // window catches both) — one still DRAFT, one already SUBMITTED.
    const draftTender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId,
        tenderNumber: `TND-REM-DRAFT-${randomUUID().slice(0, 8)}`,
        title: "Still-draft tender due today",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        status: "DRAFT",
        submissionDate: submissionDateHoursFromNow(2),
        createdById: userId,
      },
    });
    draftTenderId = draftTender.id;

    const submittedTender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId,
        tenderNumber: `TND-REM-SUBMITTED-${randomUUID().slice(0, 8)}`,
        title: "Already-submitted tender due today",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        status: "SUBMITTED",
        submissionDate: submissionDateHoursFromNow(2),
        createdById: userId,
      },
    });
    submittedTenderId = submittedTender.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { entityId: { in: [draftTenderId, submittedTenderId] } },
    });
    await prisma.tender.deleteMany({ where: { id: { in: [draftTenderId, submittedTenderId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("notifies the DRAFT tender due today with a 'today' threshold, but not the SUBMITTED one", async () => {
    await checkDeadlinesForBusiness(businessId);

    const draftNotifications = await prisma.notification.findMany({
      where: { entityType: "Tender", entityId: draftTenderId, type: "TENDER_DEADLINE_REMINDER" },
    });
    expect(draftNotifications).toHaveLength(1);
    expect(draftNotifications[0]!.title).toBe("Submission deadline is today");
    expect(draftNotifications[0]!.metadata).toEqual({ thresholdDays: 0 });

    const submittedNotifications = await prisma.notification.findMany({
      where: { entityType: "Tender", entityId: submittedTenderId, type: "TENDER_DEADLINE_REMINDER" },
    });
    expect(submittedNotifications).toHaveLength(0);
  });
});

describe("checkHourlyDeadlinesForBusiness (integration)", () => {
  let userId: string;
  let organizationId: string;
  let businessId: string;
  let soonTenderId: string;
  let laterTenderId: string;

  function submissionDateMinutesFromNow(minutes: number): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email: `reminder-hourly-${randomUUID()}@example.com`,
        passwordHash: "not-used",
        firstName: "Dev",
        lastName: "Assignee",
        isActive: true,
        isEmailVerified: true,
      },
    });
    userId = user.id;

    const business = await prisma.business.create({
      data: {
        id: randomUUID(),
        name: `Reminder Hourly Business ${randomUUID()}`,
        code: `RHB${randomUUID().slice(0, 8)}`,
      },
    });
    businessId = business.id;

    const organization = await prisma.organization.create({
      data: {
        id: randomUUID(),
        name: `Reminder Hourly Client ${randomUUID()}`,
        type: "PRIVATE",
        createdById: userId,
      },
    });
    organizationId = organization.id;

    const soonTender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId,
        tenderNumber: `TND-REM-SOON-${randomUUID().slice(0, 8)}`,
        title: "Due in 30 minutes",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        status: "DRAFT",
        submissionDate: submissionDateMinutesFromNow(30),
        createdById: userId,
      },
    });
    soonTenderId = soonTender.id;

    const laterTender = await prisma.tender.create({
      data: {
        id: randomUUID(),
        businessId,
        tenderNumber: `TND-REM-LATER-${randomUUID().slice(0, 8)}`,
        title: "Due in 2 hours",
        department: "PWD",
        clientId: organizationId,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 100000,
        status: "DRAFT",
        submissionDate: submissionDateMinutesFromNow(120),
        createdById: userId,
      },
    });
    laterTenderId = laterTender.id;
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({
      where: { entityId: { in: [soonTenderId, laterTenderId] } },
    });
    await prisma.tender.deleteMany({ where: { id: { in: [soonTenderId, laterTenderId] } } });
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.business.deleteMany({ where: { id: businessId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("notifies a tender due within the next hour, but not one due in 2 hours", async () => {
    await checkHourlyDeadlinesForBusiness(businessId);

    const soonNotifications = await prisma.notification.findMany({
      where: { entityType: "Tender", entityId: soonTenderId, type: "TENDER_DEADLINE_REMINDER" },
    });
    expect(soonNotifications).toHaveLength(1);
    expect(soonNotifications[0]!.title).toBe("Submission deadline in 1 hour");
    expect(soonNotifications[0]!.metadata).toEqual({ thresholdHours: 1 });

    const laterNotifications = await prisma.notification.findMany({
      where: { entityType: "Tender", entityId: laterTenderId, type: "TENDER_DEADLINE_REMINDER" },
    });
    expect(laterNotifications).toHaveLength(0);
  });

  it("does not notify the same tender twice across repeated runs", async () => {
    await checkHourlyDeadlinesForBusiness(businessId);

    const notifications = await prisma.notification.findMany({
      where: { entityType: "Tender", entityId: soonTenderId, type: "TENDER_DEADLINE_REMINDER" },
    });
    expect(notifications).toHaveLength(1);
  });
});
