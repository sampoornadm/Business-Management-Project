import { randomUUID } from "node:crypto";

import {
  PERMISSION_DEFINITIONS,
  ROLE_DESCRIPTIONS,
  ROLE_NAMES,
  ROLE_PERMISSION_MATRIX,
  WILDCARD_PERMISSION,
} from "@bmp/types";
import bcrypt from "bcrypt";

import { PrismaClient } from "../generated/client/index.js";

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.SEED_USER_PASSWORD ?? "ChangeMe123!";

const SAMPLE_USERS: Array<{ role: (typeof ROLE_NAMES)[number]; email: string; firstName: string; lastName: string }> = [
  { role: "SUPER_ADMIN", email: "superadmin@bmp.local", firstName: "Super", lastName: "Admin" },
  { role: "ADMIN", email: "admin@bmp.local", firstName: "Ava", lastName: "Admin" },
  { role: "TENDER_MANAGER", email: "tender.manager@bmp.local", firstName: "Tanya", lastName: "TenderManager" },
  { role: "ESTIMATOR", email: "estimator@bmp.local", firstName: "Ethan", lastName: "Estimator" },
  { role: "PURCHASE_MANAGER", email: "purchase.manager@bmp.local", firstName: "Priya", lastName: "PurchaseManager" },
  { role: "ACCOUNTS", email: "accounts@bmp.local", firstName: "Alex", lastName: "Accounts" },
  { role: "PROJECT_MANAGER", email: "project.manager@bmp.local", firstName: "Paul", lastName: "ProjectManager" },
  { role: "VIEWER", email: "viewer@bmp.local", firstName: "Vera", lastName: "Viewer" },
];

async function seedRolesAndPermissions() {
  const permissionByKey = new Map<string, string>();

  for (const def of PERMISSION_DEFINITIONS) {
    const permission = await prisma.permission.upsert({
      where: { key: def.key },
      update: { resource: def.resource, action: def.action, description: def.description },
      create: {
        id: randomUUID(),
        key: def.key,
        resource: def.resource,
        action: def.action,
        description: def.description,
      },
    });
    permissionByKey.set(def.key, permission.id);
  }

  const wildcardPermission = await prisma.permission.upsert({
    where: { key: WILDCARD_PERMISSION },
    update: {},
    create: {
      id: randomUUID(),
      key: WILDCARD_PERMISSION,
      resource: "*",
      action: "*",
      description: "Full, unrestricted access to every resource and action",
    },
  });
  permissionByKey.set(WILDCARD_PERMISSION, wildcardPermission.id);

  const roleByName = new Map<string, string>();

  for (const roleName of ROLE_NAMES) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      update: { description: ROLE_DESCRIPTIONS[roleName] },
      create: {
        id: randomUUID(),
        name: roleName,
        description: ROLE_DESCRIPTIONS[roleName],
        isSystem: true,
      },
    });
    roleByName.set(roleName, role.id);

    const permissionKeys =
      roleName === "SUPER_ADMIN" ? [WILDCARD_PERMISSION] : ROLE_PERMISSION_MATRIX[roleName];

    for (const key of permissionKeys) {
      const permissionId = permissionByKey.get(key);
      if (!permissionId) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { id: randomUUID(), roleId: role.id, permissionId },
      });
    }
  }

  return roleByName;
}

async function seedUsers(roleByName: Map<string, string>) {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);

  for (const sample of SAMPLE_USERS) {
    const roleId = roleByName.get(sample.role);
    if (!roleId) continue;

    await prisma.user.upsert({
      where: { email: sample.email },
      update: {},
      create: {
        id: randomUUID(),
        email: sample.email,
        passwordHash,
        firstName: sample.firstName,
        lastName: sample.lastName,
        roleId,
        isActive: true,
        isEmailVerified: true,
      },
    });
  }
}

// Attribution user for apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts
// (the local-folder-sync feature) — keep this email in sync with that file.
// Deactivated (isActive: false) and given a random, unshared password so it
// can never actually log in; it exists purely as a valid uploadedById FK
// target so watcher-imported documents show a clear, honest "uploaded by"
// name instead of being misattributed to whoever created the tender.
const LOCAL_DOCS_SYNC_USER_EMAIL = "local-sync@bmp.local";

async function seedLocalDocsSyncUser(roleByName: Map<string, string>) {
  const roleId = roleByName.get("VIEWER");
  if (!roleId) return;

  const passwordHash = await bcrypt.hash(randomUUID(), 12);
  await prisma.user.upsert({
    where: { email: LOCAL_DOCS_SYNC_USER_EMAIL },
    update: {},
    create: {
      id: randomUUID(),
      email: LOCAL_DOCS_SYNC_USER_EMAIL,
      passwordHash,
      firstName: "Local Folder",
      lastName: "Sync",
      roleId,
      isActive: false,
      isEmailVerified: true,
    },
  });
}

async function main() {
  console.warn("Seeding roles and permissions...");
  const roleByName = await seedRolesAndPermissions();

  console.warn("Seeding sample users...");
  await seedUsers(roleByName);

  console.warn("Seeding local docs sync system user...");
  await seedLocalDocsSyncUser(roleByName);

  console.warn(`Done. Seeded ${SAMPLE_USERS.length} users with password "${SEED_PASSWORD}".`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
