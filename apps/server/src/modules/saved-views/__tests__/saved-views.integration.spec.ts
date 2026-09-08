import { prisma } from "@bmp/database";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../../../app.js";
import {
  cleanupIntegrationTestUser,
  createIntegrationTestUser,
  type IntegrationTestUser,
} from "../../../shared/test-utils/integration-auth.js";

/**
 * Requires a real Postgres + Redis reachable via .env.test, migrated
 * (`pnpm db:migrate` against the test database). Run via
 * `pnpm --filter @bmp/server test` after `docker compose up`.
 */
describe("Saved views (integration)", () => {
  const app = createApp();
  let userOne: IntegrationTestUser;
  let userTwo: IntegrationTestUser;

  beforeAll(async () => {
    userOne = await createIntegrationTestUser(app);
    userTwo = await createIntegrationTestUser(app);
  });

  afterAll(async () => {
    await prisma.savedView.deleteMany({
      where: { userId: { in: [userOne.userId, userTwo.userId] } },
    });
    await cleanupIntegrationTestUser(userOne);
    await cleanupIntegrationTestUser(userTwo);
    await prisma.$disconnect();
  });

  it("creates a saved view and lists it back for its owner", async () => {
    const createResponse = await request(app)
      .post("/api/v1/saved-views")
      .set("Authorization", `Bearer ${userOne.accessToken}`)
      .send({
        pageKey: "tenders",
        name: "High priority",
        filters: [{ columnKey: "priority", operator: "is", value: "HIGH" }],
        visibleColumns: ["tenderNumber", "title"],
        columnOrder: ["tenderNumber", "title"],
      });
    expect(createResponse.status).toBe(201);

    const listResponse = await request(app)
      .get("/api/v1/saved-views")
      .query({ pageKey: "tenders" })
      .set("Authorization", `Bearer ${userOne.accessToken}`);
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toHaveLength(1);
    expect(listResponse.body.data[0].name).toBe("High priority");
  });

  it("does not let a different user see, rename, or delete another user's saved view", async () => {
    const createResponse = await request(app)
      .post("/api/v1/saved-views")
      .set("Authorization", `Bearer ${userOne.accessToken}`)
      .send({
        pageKey: "tenders",
        name: "Owner only",
        filters: [],
        visibleColumns: [],
        columnOrder: [],
      });
    const viewId = createResponse.body.data.id;

    const otherUsersList = await request(app)
      .get("/api/v1/saved-views")
      .query({ pageKey: "tenders" })
      .set("Authorization", `Bearer ${userTwo.accessToken}`);
    expect(otherUsersList.body.data).toHaveLength(0);

    const renameAttempt = await request(app)
      .patch(`/api/v1/saved-views/${viewId}`)
      .set("Authorization", `Bearer ${userTwo.accessToken}`)
      .send({ name: "Hijacked" });
    expect(renameAttempt.status).toBe(404);

    const deleteAttempt = await request(app)
      .delete(`/api/v1/saved-views/${viewId}`)
      .set("Authorization", `Bearer ${userTwo.accessToken}`);
    expect(deleteAttempt.status).toBe(404);
  });
});
