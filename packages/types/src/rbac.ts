export const ROLE_NAMES = [
  "SUPER_ADMIN",
  "ADMIN",
  "TENDER_MANAGER",
  "ESTIMATOR",
  "PURCHASE_MANAGER",
  "ACCOUNTS",
  "PROJECT_MANAGER",
  "VIEWER",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

export const WILDCARD_PERMISSION = "*:*";

export const PERMISSION_KEYS = [
  "users:create",
  "users:read",
  "users:update",
  "users:delete",
  "users:assign_role",
  "roles:read",
  "permissions:read",
  "attachments:create",
  "attachments:read",
  "attachments:delete",
  "audit:read",
  "sessions:revoke_others",
  "tenders:create",
  "tenders:read",
  "tenders:update",
  "tenders:delete",
  "tenders:assign",
  "tenders:change_status",
  "organizations:create",
  "organizations:read",
  "organizations:update",
  "organizations:delete",
  "tags:create",
  "tags:read",
  "tags:update",
  "tags:delete",
  "boq:create",
  "boq:read",
  "boq:update",
  "boq:delete",
  "rates:create",
  "rates:read",
  "rates:update",
  "vendors:create",
  "vendors:read",
  "vendors:update",
  "vendors:delete",
  "rfq:create",
  "rfq:read",
  "rfq:update",
  "purchase_orders:create",
  "purchase_orders:read",
  "purchase_orders:update",
  "purchase_orders:receive",
  "projects:create",
  "projects:read",
  "projects:update",
  "projects:delete",
  "finance:create",
  "finance:read",
  "finance:update",
  "finance:delete",
  "reports:read",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

interface PermissionDefinition {
  key: PermissionKey;
  resource: string;
  action: string;
  description: string;
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = PERMISSION_KEYS.map((key) => {
  const [resource = "", action = ""] = key.split(":");
  return { key, resource, action, description: `Permission to ${action} ${resource}` };
});

const ALL_STANDARD_PERMISSIONS: PermissionKey[] = [...PERMISSION_KEYS];

const TENDER_VIEW_BASELINE: PermissionKey[] = [
  "tenders:read",
  "organizations:read",
  "tags:read",
  "boq:read",
  "rates:read",
  "vendors:read",
  "rfq:read",
  "purchase_orders:read",
  "projects:read",
  "finance:read",
  "reports:read",
];

// Every operational role can at least see tenders/clients — downstream
// modules (BOQ, Purchase, Project) reference them regardless of who owns
// the tender lifecycle itself.
const OPERATIONAL_ROLE_PERMISSIONS: PermissionKey[] = [
  "users:read",
  "attachments:create",
  "attachments:read",
  ...TENDER_VIEW_BASELINE,
];

const TENDER_MANAGER_PERMISSIONS: PermissionKey[] = [
  ...OPERATIONAL_ROLE_PERMISSIONS,
  "tenders:create",
  "tenders:update",
  "tenders:delete",
  "tenders:assign",
  "tenders:change_status",
  "organizations:create",
  "organizations:update",
  "tags:create",
  "tags:update",
];

// Estimators fill in tender details/upload documents but don't own
// assignment or the status workflow — that stays with the Tender Manager.
// BOQ preparation and rate analysis are their core job, so they get full
// boq:*/rates:* rather than the read-only baseline other roles share.
const ESTIMATOR_PERMISSIONS: PermissionKey[] = [
  ...OPERATIONAL_ROLE_PERMISSIONS,
  "tenders:update",
  "boq:create",
  "boq:update",
  "boq:delete",
  "rates:create",
  "rates:update",
];

// Purchase Managers own the procurement lifecycle end-to-end (spec: "Manages
// vendors, issues RFQs, creates purchase orders, tracks deliveries").
const PURCHASE_MANAGER_PERMISSIONS: PermissionKey[] = [
  ...OPERATIONAL_ROLE_PERMISSIONS,
  "vendors:create",
  "vendors:update",
  "vendors:delete",
  "rfq:create",
  "rfq:update",
  "purchase_orders:create",
  "purchase_orders:update",
  "purchase_orders:receive",
];

// Project Managers own project execution end-to-end (spec: "Tracks ongoing
// projects: progress, material, labor, expenses").
const PROJECT_MANAGER_PERMISSIONS: PermissionKey[] = [
  ...OPERATIONAL_ROLE_PERMISSIONS,
  "projects:create",
  "projects:update",
  "projects:delete",
];

// Accounts owns the finance lifecycle end-to-end (spec: "Manages bills,
// payments, invoices, taxes, GST, and financial reports").
const ACCOUNTS_PERMISSIONS: PermissionKey[] = [
  ...OPERATIONAL_ROLE_PERMISSIONS,
  "finance:create",
  "finance:update",
  "finance:delete",
];

const VIEWER_PERMISSIONS: PermissionKey[] = [
  "users:read",
  "attachments:read",
  ...TENDER_VIEW_BASELINE,
];

/**
 * Seed-time role -> permission-key matrix. SUPER_ADMIN is granted the
 * WILDCARD_PERMISSION instead of individual keys; requirePermission()
 * treats the wildcard as "matches everything" at request time.
 */
export const ROLE_PERMISSION_MATRIX: Record<RoleName, PermissionKey[]> = {
  SUPER_ADMIN: [],
  ADMIN: ALL_STANDARD_PERMISSIONS,
  TENDER_MANAGER: TENDER_MANAGER_PERMISSIONS,
  ESTIMATOR: ESTIMATOR_PERMISSIONS,
  PURCHASE_MANAGER: PURCHASE_MANAGER_PERMISSIONS,
  ACCOUNTS: ACCOUNTS_PERMISSIONS,
  PROJECT_MANAGER: PROJECT_MANAGER_PERMISSIONS,
  VIEWER: VIEWER_PERMISSIONS,
};

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  SUPER_ADMIN: "Complete access to all modules and system configuration",
  ADMIN: "Manages company data and approves workflows; cannot modify system settings",
  TENDER_MANAGER: "Creates tenders, uploads documents, assigns estimators, tracks lifecycle",
  ESTIMATOR: "Prepares BOQs, fills rates, generates estimates and comparison sheets",
  PURCHASE_MANAGER: "Manages vendors, issues RFQs, creates purchase orders, tracks deliveries",
  ACCOUNTS: "Manages bills, payments, invoices, taxes, GST, and financial reports",
  PROJECT_MANAGER: "Tracks ongoing projects: progress, material, labor, expenses",
  VIEWER: "Read-only access across the platform",
};
