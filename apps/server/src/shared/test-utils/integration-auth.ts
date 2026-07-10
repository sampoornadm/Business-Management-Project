import { randomUUID } from "node:crypto";

import { WILDCARD_PERMISSION } from "@bmp/types";
import type { Express } from "express";
import request from "supertest";

import { prisma } from "../../infra/prisma/client.js";
import { hashPassword } from "../utils/hash.js";

export interface IntegrationTestUser {
  userId: string;
  email: string;
  businessId: string;
  secondBusinessId: string;
  accessToken: string;
}

export async function createIntegrationTestUser(app: Express): Promise<IntegrationTestUser> {
  const email = `integration-${randomUUID()}@example.com`;
  const password = "Password123";

  const permission = await prisma.permission.upsert({
    where: { key: WILDCARD_PERMISSION },
    update: {},
    create: { id: randomUUID(), key: WILDCARD_PERMISSION, resource: "*", action: "*" },
  });
  const role = await prisma.role.upsert({
    where: { name: "SUPER_ADMIN" },
    update: {},
    create: { id: randomUUID(), name: "SUPER_ADMIN", description: "Super Admin", isSystem: true },
  });
  await prisma.rolePermission.upsert({
    where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
    update: {},
    create: { id: randomUUID(), roleId: role.id, permissionId: permission.id },
  });

  const business = await prisma.business.create({
    data: { id: randomUUID(), name: `Integration Business ${randomUUID()}`, code: `IB${randomUUID().slice(0, 8)}` },
  });
  const secondBusiness = await prisma.business.create({
    data: { id: randomUUID(), name: `Integration Business B ${randomUUID()}`, code: `IB2${randomUUID().slice(0, 8)}` },
  });

  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(password),
      firstName: "Integration",
      lastName: "Tester",
      isActive: true,
      isEmailVerified: true,
    },
  });

  await prisma.userBusiness.create({ data: { userId: user.id, businessId: business.id, roleId: role.id } });
  await prisma.userBusiness.create({ data: { userId: user.id, businessId: secondBusiness.id, roleId: role.id } });

  const loginResponse = await request(app).post("/api/v1/auth/login").send({ email, password });

  return {
    userId: user.id,
    email,
    businessId: business.id,
    secondBusinessId: secondBusiness.id,
    accessToken: loginResponse.body.data.accessToken as string,
  };
}

export async function cleanupIntegrationTestUser(testUser: IntegrationTestUser): Promise<void> {
  await prisma.userBusiness.deleteMany({ where: { userId: testUser.userId } });
  await prisma.business.deleteMany({ where: { id: { in: [testUser.businessId, testUser.secondBusinessId] } } });
  await prisma.user.deleteMany({ where: { id: testUser.userId } });
}

/**
 * Switches an integration test user into the second business it also
 * belongs to. Switching requires a fresh login token (the original access
 * token's embedded businessId claim doesn't change), then trades it for a
 * token scoped to the second business via the real switch-business flow.
 */
export async function switchToSecondBusiness(app: Express, testUser: IntegrationTestUser): Promise<string> {
  const otherLogin = await request(app).post("/api/v1/auth/login").send({
    email: testUser.email,
    password: "Password123",
  });
  const switchResponse = await request(app)
    .post("/api/v1/auth/switch-business")
    .set("Authorization", `Bearer ${otherLogin.body.data.accessToken}`)
    .send({ businessId: testUser.secondBusinessId });
  return switchResponse.body.data.accessToken as string;
}
