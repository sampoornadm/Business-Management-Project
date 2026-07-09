# Tender Documents Tab Compact Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Documents tab's 8 full-size shadcn `Card`s (one per document type, each with an 8-line dashed dropzone) with one compact, uniform row-list, and add Playwright E2E coverage for it.

**Architecture:** Two coupled presentation-only changes shipped in one commit (splitting them would leave an intermediate typecheck-broken state, since the shared component's prop signature changes): `DocumentUpload` in `packages/ui` stops rendering a `Card` and renders a single ~48px row instead; its one caller, `TenderDocumentsTab`, stops rendering a 2-column card grid per type and instead renders one bordered `divide-y` list, with a compact "Add another file" link (not a second empty card) for types that already have files. No API, hook, or data-model changes.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, shadcn/ui + Tailwind + Lucide icons (all already installed — no new dependencies), Playwright (already installed and already the convention for page/component-level tests per `apps/web/vitest.config.ts`'s explicit scoping comment).

## Global Constraints

- No new npm dependencies — shadcn/ui, Tailwind, Lucide, and Playwright are all already installed.
- No changes to `AttachmentsService`, the upload/delete/versions API routes, or the `documentGroupId`/`isCurrent` versioning model — presentation-only.
- No changes to the "extract from document" AI upload flow on `/tenders/new` — unrelated feature.
- Follow the repo's existing E2E convention exactly: fixtures created via direct `request.post` calls in `test.beforeAll` (see `apps/web/e2e/reports-and-search.spec.ts`), `getByRole`/`getByText` selectors, `login()`/`apiLogin()` helpers from `./helpers`.
- `DocumentUpload`'s `label` prop is removed (the document-type label moves to `TenderDocumentsTab`, rendered once per type instead of once per file row) — confirmed safe via `grep -rln "DocumentUpload" apps/web/src packages/ui/src`, which shows exactly one caller (`tender-documents-tab.tsx`).

---

## File Structure

- **Modify** `packages/ui/src/components/document-upload.tsx` — `DocumentUpload` renders a compact row instead of a `Card`; drops the `label` prop; keeps `versions`/`onUpload`/`onDelete`/`isUploading`/`isDeleting`/`accept`/`className` unchanged.
- **Modify** `apps/web/src/components/tenders/tender-documents-tab.tsx` — replaces the `grid md:grid-cols-2` card grid with a single `divide-y` list; splits the old "existing lineage vs. add-new" `DocumentLineage` into three focused pieces: `DocumentLineage` (an existing file, always has a `documentGroupId`), `EmptyDocumentSlot` (a type with zero files — the one visible row), and `AddAnotherFileLink` (compact text link for adding another file to a type that already has one).
- **Create** `apps/web/e2e/tender-documents.spec.ts` — new Playwright spec, following `reports-and-search.spec.ts`'s fixture-via-API pattern.

---

### Task 1: Add the Playwright E2E spec (red)

**Files:**
- Create: `apps/web/e2e/tender-documents.spec.ts`

**Interfaces:**
- Consumes: `API_BASE_URL`, `apiLogin`, `login` from `./helpers` (existing, unchanged).
- Consumes (post-Task-2 UI, doesn't exist yet — this is why the test fails right now): a `role="group"` element per document type labeled with that type's display name (e.g. `"Bill of Quantities (BOQ)"`, `"Drawings"`), containing an `input[type="file"]`, an "Upload"-or-"Replace"-labeled button, a "Delete file"-labeled button, and — only once a type already has a file — an "Add another file"-labeled button.

- [ ] **Step 1: Write the spec**

```typescript
import { expect, test } from "@playwright/test";

import { API_BASE_URL, apiLogin, login } from "./helpers";

test.describe("Tender documents", () => {
  let tenderId: string;
  let tenderTitle: string;

  test.beforeAll(async ({ request }) => {
    const accessToken = await apiLogin(request);
    tenderTitle = `E2E Documents Tender ${Date.now()}`;

    const orgResponse = await request.post(`${API_BASE_URL}/organizations`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name: `E2E Documents Client ${Date.now()}`, type: "PRIVATE" },
    });
    const org = (await orgResponse.json()).data;

    const tenderResponse = await request.post(`${API_BASE_URL}/tenders`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: {
        tenderNumber: `TND-E2E-DOC-${Date.now()}`,
        title: tenderTitle,
        department: "PWD",
        clientId: org.id,
        type: "OPEN",
        category: "ROAD",
        location: "Test City",
        state: "Test State",
        estimatedCost: 500000,
        submissionDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        priority: "MEDIUM",
      },
    });
    expect(tenderResponse.ok()).toBe(true);
    tenderId = (await tenderResponse.json()).data.id;
  });

  test("uploads, replaces, and deletes a document as a compact row; supports multiple files per type", async ({
    page,
  }) => {
    await login(page);
    await page.goto(`/tenders/${tenderId}`);
    await page.getByRole("tab", { name: "Documents" }).click();

    const boqSection = page.getByRole("group", { name: "Bill of Quantities (BOQ)" });
    await expect(boqSection.getByText("No file uploaded")).toBeVisible();

    await boqSection.locator('input[type="file"]').setInputFiles({
      name: "boq-v1.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("first version"),
    });
    await expect(boqSection.getByText("boq-v1.txt")).toBeVisible({ timeout: 10_000 });
    await expect(boqSection.getByRole("button", { name: "Replace" })).toBeVisible();

    // Replace with a second version.
    await boqSection.locator('input[type="file"]').setInputFiles({
      name: "boq-v2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("second version"),
    });
    await expect(boqSection.getByText("boq-v2.txt")).toBeVisible({ timeout: 10_000 });
    await boqSection.getByRole("button", { name: /version history/ }).click();
    await expect(boqSection.getByText("v2")).toBeVisible();
    await expect(boqSection.getByText("v1")).toBeVisible();

    // Delete it — back to the empty-row state.
    page.once("dialog", (dialog) => dialog.accept());
    await boqSection.getByRole("button", { name: "Delete file" }).click();
    await expect(boqSection.getByText("No file uploaded")).toBeVisible({ timeout: 10_000 });

    // A type that already has a file shows "Add another file" instead of a second empty row.
    const drawingsSection = page.getByRole("group", { name: "Drawings" });
    await drawingsSection.locator('input[type="file"]').setInputFiles({
      name: "drawing-1.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("drawing one"),
    });
    await expect(drawingsSection.getByText("drawing-1.txt")).toBeVisible({ timeout: 10_000 });

    await expect(drawingsSection.getByRole("button", { name: "Add another file" })).toBeVisible();
    await drawingsSection.locator('input[type="file"]').last().setInputFiles({
      name: "drawing-2.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("drawing two"),
    });
    await expect(drawingsSection.getByText("drawing-1.txt")).toBeVisible({ timeout: 10_000 });
    await expect(drawingsSection.getByText("drawing-2.txt")).toBeVisible({ timeout: 10_000 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails against the current (card-based) UI**

Requires the dev stack running: `docker compose up -d postgres redis minio minio-init mailhog` and `pnpm dev` (per this repo's `CLAUDE.md` — don't run a bare `docker compose up -d` alongside `pnpm dev`, and don't run this while `apps/web/.next` is mid-build from another command).

Run: `pnpm --filter @bmp/web test:e2e -- e2e/tender-documents.spec.ts`

Expected: FAIL. The current UI has no element with an accessible `role="group"` name matching a document type label (today's `DocumentTypeSection` renders a plain `<h3>`, not a labeled group), so `page.getByRole("group", { name: "Bill of Quantities (BOQ)" })` resolves to zero elements and the first assertion times out.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/tender-documents.spec.ts
git commit -m "test: add E2E spec for the redesigned tender documents tab"
```

---

### Task 2: Redesign `DocumentUpload` and `TenderDocumentsTab` (green)

**Files:**
- Modify: `packages/ui/src/components/document-upload.tsx`
- Modify: `apps/web/src/components/tenders/tender-documents-tab.tsx`

**Interfaces:**
- Consumes: nothing new — same hooks (`useTenderDocumentVersions`, `useUploadTenderDocument`, `useDeleteTenderDocument`, `useTenderDocuments`) and same `AttachmentDto` shape as today.
- Produces: `DocumentUpload(props: { versions: DocumentVersion[]; onUpload: (file: File) => void | Promise<void>; onDelete?: () => void | Promise<void>; isUploading?: boolean; isDeleting?: boolean; accept?: string; className?: string })` — same as before minus `label`. `DocumentVersion` type is unchanged.

- [ ] **Step 1: Rewrite `packages/ui/src/components/document-upload.tsx`**

```typescript
"use client";

import { Loader2, Trash2, Upload } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

import { Badge } from "./badge";

export interface DocumentVersion {
  id: string;
  version: number;
  originalName: string;
  url: string;
  uploadedByName: string;
  uploadedAt: string;
  isCurrent: boolean;
  sizeBytes: number;
}

export interface DocumentUploadProps {
  versions: DocumentVersion[];
  onUpload: (file: File) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  isUploading?: boolean;
  isDeleting?: boolean;
  accept?: string;
  className?: string;
}

const DEFAULT_ACCEPT =
  "application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  const formatted = exponent === 0 ? value.toString() : value.toFixed(1);
  return `${formatted} ${units[exponent]}`;
}

export function DocumentUpload({
  versions,
  onUpload,
  onDelete,
  isUploading = false,
  isDeleting = false,
  accept = DEFAULT_ACCEPT,
  className,
}: DocumentUploadProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [showHistory, setShowHistory] = React.useState(false);

  const currentVersion = versions.find((version) => version.isCurrent) ?? versions[0];
  const hasVersions = versions.length > 0;
  const historyVersions = [...versions].sort((a, b) => b.version - a.version);

  const handleTriggerClick = () => {
    if (!isUploading) {
      inputRef.current?.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void onUpload(file);
    }
    event.target.value = "";
  };

  return (
    <div className={cn("w-full min-w-0 py-2", className)}>
      <input ref={inputRef} type="file" accept={accept} onChange={handleFileChange} className="hidden" />

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {hasVersions ? (
            <>
              <a
                href={currentVersion?.url}
                target="_blank"
                rel="noreferrer"
                className="block truncate text-sm font-medium text-primary hover:underline"
                title={currentVersion?.originalName}
              >
                {currentVersion?.originalName}
              </a>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {currentVersion ? formatBytes(currentVersion.sizeBytes) : ""}
                {versions.length > 1 ? ` · v${currentVersion?.version}` : ""} · Uploaded by{" "}
                {currentVersion?.uploadedByName}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No file uploaded</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={handleTriggerClick}
            disabled={isUploading}
            className={cn(
              "inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-background px-2.5 text-xs font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
            )}
          >
            {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {hasVersions ? "Replace" : "Upload"}
          </button>
          {onDelete && hasVersions ? (
            <button
              type="button"
              onClick={() => void onDelete()}
              disabled={isDeleting || isUploading}
              aria-label="Delete file"
              className={cn(
                "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input bg-background text-destructive ring-offset-background transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
              )}
            >
              {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          ) : null}
        </div>
      </div>

      {versions.length > 1 ? (
        <div className="mt-1.5">
          <button
            type="button"
            onClick={() => setShowHistory((value) => !value)}
            className="text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showHistory ? "Hide" : "Show"} version history ({versions.length})
          </button>
          {showHistory ? (
            <ul className="mt-2 space-y-2">
              {historyVersions.map((version) => (
                <li
                  key={version.id}
                  className="flex items-center justify-between gap-4 rounded-md border p-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant="secondary" className="shrink-0 font-semibold">
                      v{version.version}
                    </Badge>
                    <div className="min-w-0">
                      <a
                        href={version.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium text-primary hover:underline"
                      >
                        {version.originalName}
                      </a>
                      <p className="truncate text-muted-foreground">
                        {version.uploadedByName} &middot; {new Date(version.uploadedAt).toLocaleString()} &middot;{" "}
                        {formatBytes(version.sizeBytes)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `apps/web/src/components/tenders/tender-documents-tab.tsx`**

```typescript
"use client";

import { TENDER_DOCUMENT_TYPES, type TenderDocumentType } from "@bmp/types";
import { DocumentUpload, type DocumentVersion, useToast } from "@bmp/ui";
import { Loader2, Plus } from "lucide-react";
import { useRef, type ChangeEvent } from "react";

import {
  useDeleteTenderDocument,
  useTenderDocumentVersions,
  useTenderDocuments,
  useUploadTenderDocument,
} from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const DOCUMENT_TYPE_LABELS: Record<TenderDocumentType, string> = {
  NIT: "Notice Inviting Tender (NIT)",
  BOQ: "Bill of Quantities (BOQ)",
  TECHNICAL_SPECS: "Technical Specifications",
  DRAWINGS: "Drawings",
  CORRIGENDUM: "Corrigendum",
  TENDER_NOTICE: "Tender Notice",
  ADDENDUM: "Addendum",
  GENERAL: "General Documents",
};

// An existing file lineage (a specific file + its version history). Always has a
// documentGroupId — the empty and "add another" slots are separate components below.
function DocumentLineage({
  tenderId,
  documentType,
  documentGroupId,
  canDelete,
}: {
  tenderId: string;
  documentType: TenderDocumentType;
  documentGroupId: string;
  canDelete: boolean;
}) {
  const { toast } = useToast();
  const versionsQuery = useTenderDocumentVersions(tenderId, documentGroupId);
  const upload = useUploadTenderDocument(tenderId);
  const deleteDocument = useDeleteTenderDocument(tenderId);

  const versions: DocumentVersion[] = (versionsQuery.data ?? []).map((doc) => ({
    id: doc.id,
    version: doc.version,
    originalName: doc.originalName,
    url: doc.url,
    uploadedByName: `${doc.uploadedBy.firstName} ${doc.uploadedBy.lastName}`,
    uploadedAt: doc.createdAt,
    isCurrent: doc.isCurrent,
    sizeBytes: doc.sizeBytes,
  }));

  async function handleUpload(file: File) {
    try {
      await upload.mutateAsync({ file, documentType, replacesAttachmentId: documentGroupId });
      toast({ title: "Document uploaded" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this file? All of its versions will be removed.")) return;
    try {
      await deleteDocument.mutateAsync(documentGroupId);
      toast({ title: "Document deleted" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete document",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <DocumentUpload
      versions={versions}
      onUpload={handleUpload}
      onDelete={canDelete ? handleDelete : undefined}
      isUploading={upload.isPending}
      isDeleting={deleteDocument.isPending}
    />
  );
}

// The one visible row for a document type that has zero files yet.
function EmptyDocumentSlot({
  tenderId,
  documentType,
}: {
  tenderId: string;
  documentType: TenderDocumentType;
}) {
  const { toast } = useToast();
  const upload = useUploadTenderDocument(tenderId);

  async function handleUpload(file: File) {
    try {
      await upload.mutateAsync({ file, documentType });
      toast({ title: "Document uploaded" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return <DocumentUpload versions={[]} onUpload={handleUpload} isUploading={upload.isPending} />;
}

// Compact text-link affordance for adding another file to a type that already has one,
// instead of a second full empty row.
function AddAnotherFileLink({
  tenderId,
  documentType,
}: {
  tenderId: string;
  documentType: TenderDocumentType;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadTenderDocument(tenderId);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await upload.mutateAsync({ file, documentType });
      toast({ title: "Document uploaded" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="px-4 pb-2.5">
      <input ref={inputRef} type="file" onChange={handleFileChange} className="hidden" />
      <button
        type="button"
        onClick={() => !upload.isPending && inputRef.current?.click()}
        disabled={upload.isPending}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        {upload.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
        {upload.isPending ? "Uploading..." : "Add another file"}
      </button>
    </div>
  );
}

function DocumentTypeSection({
  tenderId,
  documentType,
  documentGroupIds,
  canDelete,
}: {
  tenderId: string;
  documentType: TenderDocumentType;
  documentGroupIds: string[];
  canDelete: boolean;
}) {
  const hasFiles = documentGroupIds.length > 0;

  return (
    <div role="group" aria-label={DOCUMENT_TYPE_LABELS[documentType]}>
      <h3 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {DOCUMENT_TYPE_LABELS[documentType]}
      </h3>
      <div className="divide-y px-4">
        {hasFiles ? (
          documentGroupIds.map((documentGroupId) => (
            <DocumentLineage
              key={documentGroupId}
              tenderId={tenderId}
              documentType={documentType}
              documentGroupId={documentGroupId}
              canDelete={canDelete}
            />
          ))
        ) : (
          <EmptyDocumentSlot tenderId={tenderId} documentType={documentType} />
        )}
      </div>
      {hasFiles ? <AddAnotherFileLink tenderId={tenderId} documentType={documentType} /> : null}
    </div>
  );
}

export function TenderDocumentsTab({ tenderId }: { tenderId: string }) {
  const documentsQuery = useTenderDocuments(tenderId);
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canDelete = hasPermission(roleName, "attachments:delete");

  const groupIdsByType = new Map<TenderDocumentType, string[]>();
  for (const doc of documentsQuery.data ?? []) {
    if (!doc.documentType || !doc.documentGroupId) continue;
    const type = doc.documentType as TenderDocumentType;
    const existing = groupIdsByType.get(type) ?? [];
    existing.push(doc.documentGroupId);
    groupIdsByType.set(type, existing);
  }

  return (
    <div className="divide-y rounded-md border">
      {TENDER_DOCUMENT_TYPES.map((documentType) => (
        <DocumentTypeSection
          key={documentType}
          tenderId={tenderId}
          documentType={documentType}
          documentGroupIds={groupIdsByType.get(documentType) ?? []}
          canDelete={canDelete}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `pnpm --filter @bmp/web typecheck && pnpm --filter @bmp/ui typecheck`
Expected: both PASS with no errors (stop the dev server first if it's running, per this repo's known `.next/types` race — see `CLAUDE.md` gotchas).

Run: `pnpm --filter @bmp/web lint && pnpm --filter @bmp/ui lint`
Expected: both PASS with no errors.

- [ ] **Step 4: Run the E2E spec from Task 1 again to verify it now passes**

Run: `pnpm --filter @bmp/web test:e2e -- e2e/tender-documents.spec.ts`
Expected: PASS (1 test). If it fails on the upload step with an "Unsupported file type" or similar 400, confirm the `<S3_BUCKET>-test` MinIO bucket exists (`docker compose up -d minio-init` — see `CLAUDE.md` gotchas) and that Redis isn't rate-limiting logins from repeated runs (`docker compose exec redis redis-cli FLUSHALL`).

- [ ] **Step 5: Manual visual check**

With `pnpm dev` running, open a tender's Documents tab in a browser for a tender with 0 documents, then again after uploading 1-2 documents. Confirm the list reads as one compact, uniform block (no more full-height cards) and that long filenames truncate with an ellipsis instead of wrapping/overflowing.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/document-upload.tsx apps/web/src/components/tenders/tender-documents-tab.tsx
git commit -m "feat: compact row layout for the tender documents tab"
```
