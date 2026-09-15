"use client";

import type { AuditLogDto } from "@bmp/types";
import { Badge, formatDateTime, SortableHeader } from "@bmp/ui";
import type { FilterableColumnDef } from "@bmp/ui";
import type { ColumnDef } from "@tanstack/react-table";

export interface AuditLogColumnConfig extends FilterableColumnDef {
  sortable: boolean;
  filterable: boolean;
  defaultVisible: boolean;
  cell: ColumnDef<AuditLogDto>["cell"];
}

function titleCase(constantCase: string): string {
  return constantCase
    .toLowerCase()
    .replace(/(^|_)([a-z])/g, (_match, sep: string, char: string) => (sep ? " " : "") + char.toUpperCase());
}

// Every literal `action: "..."` value ever passed to AuditService.log(...) across the codebase
// (grepped from apps/server/src/modules — see task notes). AuditLog.action is a plain string
// column, not a DB enum, so this list is a snapshot: a newly-added action elsewhere in the
// codebase won't appear in this dropdown until this list is updated, but it's never rejected —
// filterConditionSchema's `value` stays free-form server-side either way.
const AUDIT_ACTIONS = [
  "AUTH_BUSINESS_SWITCHED",
  "AUTH_EMAIL_VERIFIED",
  "AUTH_LOGIN_FAILURE",
  "AUTH_LOGIN_SUCCESS",
  "AUTH_LOGOUT",
  "AUTH_LOGOUT_ALL",
  "AUTH_PASSWORD_CHANGED",
  "AUTH_PASSWORD_RESET_COMPLETED",
  "AUTH_PASSWORD_RESET_REQUESTED",
  "AUTH_SESSION_REVOKED",
  "AUTH_TOKEN_REUSE_DETECTED",
  "BANK_ACCOUNT_CREATED",
  "BANK_ACCOUNT_DELETED",
  "BANK_ACCOUNT_UPDATED",
  "BILL_CREATED",
  "BOQ_COMMITTED",
  "BOQ_FINALIZED",
  "BOQ_ITEMS_BULK_UPDATED",
  "BOQ_ITEM_ADDED",
  "BOQ_ITEM_DELETED",
  "BOQ_ITEM_RATE_ANALYSIS_UPDATED",
  "BOQ_ITEM_UPDATED",
  "BOQ_RATE_SUGGESTION_CONFIRMED",
  "BOQ_RATE_SUGGESTION_REJECTED",
  "BUSINESS_CREATED",
  "BUSINESS_DELETED",
  "BUSINESS_MEMBER_ADDED",
  "BUSINESS_MEMBER_REMOVED",
  "BUSINESS_MEMBER_ROLE_UPDATED",
  "BUSINESS_UPDATED",
  "EXPENSE_CREATED",
  "EXPENSE_UPDATED",
  "GOODS_RECEIPT_RECORDED",
  "INVOICE_CREATED",
  "INVOICE_CREATED_FROM_BILL",
  "INVOICE_UPDATED",
  "ITEM_CLASSIFIED",
  "ORGANIZATION_CONTACT_ADDED",
  "ORGANIZATION_CONTACT_DELETED",
  "ORGANIZATION_CONTACT_UPDATED",
  "ORGANIZATION_CREATED",
  "ORGANIZATION_DELETED",
  "ORGANIZATION_UPDATED",
  "PAYMENT_RECORDED",
  "PROJECT_BILL_CREATED",
  "PROJECT_BILL_STATUS_UPDATED",
  "PROJECT_CREATED_FROM_TENDER",
  "PROJECT_LABOR_ENTRY_RECORDED",
  "PROJECT_MATERIAL_USAGE_RECORDED",
  "PROJECT_MILESTONE_ADDED",
  "PROJECT_MILESTONE_DELETED",
  "PROJECT_MILESTONE_UPDATED",
  "PROJECT_UPDATED",
  "PURCHASE_ORDER_CREATED",
  "PURCHASE_ORDER_CREATED_FROM_RFQ",
  "RFQ_CLOSED",
  "RFQ_CREATED",
  "RFQ_QUOTES_IMPORTED",
  "RFQ_QUOTE_RECORDED",
  "RFQ_QUOTE_SELECTED",
  "RFQ_RATES_PUSHED_TO_TENDER",
  "RFQ_REOPENED",
  "RFQ_UPDATED",
  "RFQ_VENDOR_INVITED",
  "RFQ_VENDOR_REMOVED",
  "TENDER_ASSIGNED",
  "TENDER_AUTO_CREATED_FROM_INGESTION",
  "TENDER_COMPETITOR_ADDED",
  "TENDER_COMPETITOR_DELETED",
  "TENDER_COMPETITOR_UPDATED",
  "TENDER_CREATED",
  "TENDER_DELETED",
  "TENDER_DOCUMENT_DELETED",
  "TENDER_DOCUMENT_UPLOADED",
  "TENDER_NOTE_PINNED",
  "TENDER_NOTE_UNPINNED",
  "TENDER_STATUS_CHANGED",
  "TENDER_TAGS_UPDATED",
  "TENDER_UNASSIGNED",
  "TENDER_UPDATED",
  "USER_AVATAR_REMOVED",
  "USER_AVATAR_UPDATED",
  "USER_CREATED",
  "USER_PROFILE_UPDATED",
  "USER_ROLE_ASSIGNED",
  "USER_THEME_COLOR_UPDATED",
  "USER_UPDATED",
  "VENDOR_CONTACT_ADDED",
  "VENDOR_CONTACT_DELETED",
  "VENDOR_CONTACT_UPDATED",
  "VENDOR_CREATED",
  "VENDOR_DELETED",
  "VENDOR_ITEM_TAGS_IMPORTED",
  "VENDOR_ITEM_TAG_ADDED",
  "VENDOR_ITEM_TAG_REMOVED",
  "VENDOR_RATED",
  "VENDOR_UPDATED",
] as const;

// Every literal `entityType: "..."` value passed alongside those auditService.log(...) calls.
const AUDIT_ENTITY_TYPES = [
  "BankAccount",
  "Bill",
  "BoqItem",
  "Business",
  "Expense",
  "Invoice",
  "Item",
  "Organization",
  "Project",
  "PurchaseOrder",
  "RefreshToken",
  "Rfq",
  "Tender",
  "User",
  "Vendor",
] as const;

const ACTION_OPTIONS = AUDIT_ACTIONS.map((a) => ({ value: a, label: titleCase(a) }));
const ENTITY_TYPE_OPTIONS = AUDIT_ENTITY_TYPES.map((t) => ({ value: t, label: t }));

export const AUDIT_LOG_COLUMNS: AuditLogColumnConfig[] = [
  {
    key: "actorId",
    label: "Actor",
    // Dynamic: populated per-page from the actors currently in view (same trick tenders' page
    // uses for its clientName column) — see the page component's `actorOptions` useMemo. Backend
    // matches by exact actorId, a real indexed column, not by the displayed name.
    type: "enum",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    cell: ({ row }) =>
      row.original.actor ? `${row.original.actor.firstName} ${row.original.actor.lastName}` : "System",
  },
  {
    key: "action",
    label: "Action",
    type: "enum",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    enumOptions: ACTION_OPTIONS,
    cell: ({ row }) => <Badge variant="outline">{row.original.action}</Badge>,
  },
  {
    key: "entityType",
    label: "Entity Type",
    type: "enum",
    sortable: true,
    filterable: true,
    nullable: true,
    defaultVisible: true,
    enumOptions: ENTITY_TYPE_OPTIONS,
    cell: ({ row }) => row.original.entityType ?? "-",
  },
  {
    key: "entityId",
    label: "Entity ID",
    type: "text",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.entityId ?? "-",
  },
  {
    key: "ipAddress",
    label: "IP Address",
    type: "text",
    sortable: false,
    filterable: true,
    nullable: true,
    defaultVisible: false,
    cell: ({ row }) => row.original.ipAddress ?? "-",
  },
  {
    key: "createdAt",
    label: "When",
    type: "date",
    sortable: true,
    filterable: true,
    defaultVisible: true,
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
];

export const AUDIT_LOG_DEFAULT_VISIBLE_KEYS = AUDIT_LOG_COLUMNS.filter((c) => c.defaultVisible).map(
  (c) => c.key,
);
export const AUDIT_LOG_DEFAULT_ORDER = AUDIT_LOG_COLUMNS.map((c) => c.key);

export function buildAuditLogColumnDefs({
  visibleKeys,
  order,
}: {
  visibleKeys: string[];
  order: string[];
}): ColumnDef<AuditLogDto>[] {
  const configByKey = new Map(AUDIT_LOG_COLUMNS.map((c) => [c.key, c]));
  return order
    .filter((key) => visibleKeys.includes(key))
    .map((key) => configByKey.get(key))
    .filter((config): config is AuditLogColumnConfig => Boolean(config))
    .map((config) => ({
      id: config.key,
      ...(config.sortable ? { accessorFn: () => config.key } : {}),
      header: config.sortable
        ? ({ column }) => <SortableHeader column={column} label={config.label} />
        : config.label,
      cell: config.cell,
      enableSorting: config.sortable,
    }));
}
