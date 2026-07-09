# Tender documents: local-folder auto-sync, multi-file per type, filename overflow fix

## Context

Tender documents currently go through the generic `AttachmentsService`
(`apps/server/src/modules/attachments/`), uploaded one at a time through the Documents tab's file
picker. Three problems surfaced:

1. Long filenames overflow the Documents tab's cards instead of truncating.
2. Each document type (NIT, BOQ, Technical Specs, Drawings, ...) is treated as a single "slot" —
   uploading a second file for a type is only ever a *version replacement* of the first, never an
   independent additional file. The user needs to dump multiple files (photos, docs) under one type.
3. The user wants to manage tender documents primarily as local files/folders on their own machine —
   dropping files into a folder and having them appear in the app automatically — rather than
   uploading one at a time through a browser file picker.

Confirmed with the user (via AskUserQuestion): the local-folder sync should be a **continuous
background watcher** (not a manual "sync" button), the **app auto-creates the folder tree** per
tender (not user-managed folder names), local file **deletions are ignored** (one-way, append-only
sync — deleting from the app's UI is the way to actually remove a document), and **Tender Manager
gets `attachments:delete`** so they can remove a mis-uploaded file without an Admin.

This only makes sense while the app's server/worker process runs on the same machine as the watched
folder — true for the current local dev setup (`pnpm dev`). It's opt-in via an env flag so it's a
no-op for any environment that doesn't set it (e.g. a future remote deployment).

## Design

### 1. Filename overflow fix (small, standalone)

Root cause: `DocumentUpload`'s card (`packages/ui/src/components/document-upload.tsx`) is placed as a
grid item inside `tender-documents-tab.tsx`'s `grid md:grid-cols-2` without `min-w-0`. The filename
`<a>` already has `truncate`, and its immediate flex parent already has `min-w-0 flex-1` — but
`white-space: nowrap` (from `truncate`) makes the anchor's min-content width equal its full
unwrapped text width, and with no `min-w-0` on the Card (the grid item), that width bubbles up and
forces the card/grid to overflow instead of clipping.

Fix: change the Card's root className in `document-upload.tsx` from `cn("w-full", className)` to
`cn("w-full min-w-0", className)` — self-contained so this can't recur wherever the component is
embedded next.

### 2. Multiple independent files per document type

The DB already supports this — `Attachment` has no uniqueness constraint on
`(entityType, entityId, documentType)` (confirmed in `packages/database/prisma/schema.prisma`); the
"one file per type" behavior is purely a frontend convention (`tender-documents-tab.tsx`'s
`currentByType.get(documentType)` picks a single current attachment per type). So this is a
**frontend-only redesign**, plus wiring up delete:

- `apps/web/src/components/tenders/tender-documents-tab.tsx`: for each `documentType`, instead of
  picking one current attachment, group all of that type's attachments by `documentGroupId` (each
  group = one independent file lineage, versions-of-each-other). Render one `DocumentUpload` card per
  lineage (unchanged single-lineage semantics: shows current version + "Replace" + version history),
  plus a trailing "+ Add another file" control that uploads a brand-new file for that type with no
  `replacesAttachmentId` — which, since there's no DB constraint, simply becomes a second independent
  lineage under the same type.
- `packages/ui/src/components/document-upload.tsx`: add an optional `onDelete` prop — a small trash
  icon next to "Replace" — so a whole lineage (a specific file, all its versions) can be removed.
- Backend: add `DELETE /tenders/:id/documents/:documentGroupId` (new route in `tenders.routes.ts`,
  gated by `requirePermission("attachments:delete")`) → `TendersService.deleteDocument(tenderId,
  documentGroupId, actorId)`, which loads all versions via the existing
  `attachmentsService.listVersions(documentGroupId)`, calls the existing
  `attachmentsService.deleteById(id)` (already handles S3 object removal, `attachments.service.ts:174`)
  for each, and logs one `TENDER_DOCUMENT_DELETED` audit entry — reusing existing primitives, no new
  attachment-layer code needed.
- `apps/web/src/hooks/use-tenders.ts`: add `useDeleteTenderDocument(tenderId)` mirroring the existing
  `useUploadTenderDocument(tenderId)` hook shape, invalidating the same query keys.
- RBAC: add `"attachments:delete"` to `TENDER_MANAGER_PERMISSIONS` in `packages/types/src/rbac.ts`
  (confirmed with the user) — needs a reseed (`pnpm db:seed`) + Redis flush to take effect, same as
  every prior RBAC grant this session.

### 3. Local-folder auto-sync (new: continuous watcher)

**Folder layout** (auto-created by the app, one tree per tender):
```
<LOCAL_DOCS_ROOT_DIR>/
  1400013124 - MJ-C06-2025-3063-FLENGE/
    NIT/
    BOQ/
    Technical Specs/
    Drawings/
    Corrigendum/
    Tender Notice/
    Addendum/
    General/
  ABC123 - Test Tender with 2 Items/
    NIT/
    BOQ/
    ...
```
- New shared constant `TENDER_DOCUMENT_TYPE_FOLDER_NAMES: Record<TenderDocumentType, string>` in
  `packages/types/src/tender.ts` (short, filesystem-friendly labels: "NIT", "BOQ", "Technical Specs",
  "Drawings", "Corrigendum", "Tender Notice", "Addendum", "General") — used both to create the
  subfolders and, reversed, to map a subfolder name back to a `documentType` when a file is dropped in.
  Files dropped directly in the tender's root folder (not in any subfolder), or in an unrecognized
  subfolder name, default to `GENERAL`.
- **Folder naming**: `"${tender.tenderNumber} - ${sanitizedTitle}"`. Since `Tender.tenderNumber` is
  already `@unique` (schema confirmed) and, in practice, plain alphanumeric (no path-illegal
  characters in any real tender seen so far), it's used as-is; only `title` is sanitized (strip
  `/ \ : * ? " < > |`, trim, cap length). **No new DB column needed** — resolving a folder back to a
  tender is just `folderName.split(" - ")[0]` → the existing `ITendersRepository.findByTenderNumber`
  (`tenders.repository.ts:99`, already implemented). This is also rename-safe: if a tender's title is
  edited later, the on-disk folder name goes stale but the leading tender-number token still resolves
  correctly, so sync doesn't silently break.
- **Folder creation**: new pure helper module `apps/server/src/modules/tenders/local-docs/folder-naming.ts`
  (`tenderFolderName(tender)`, `documentTypeForFolder(name)`, `ensureTenderFolders(rootDir, tender)` —
  `fs.mkdir(..., { recursive: true })` per subfolder, idempotent). Called from
  `TendersService.create` right after the tender row is created (fire-and-forget is fine — a failure
  to create local folders shouldn't fail tender creation; log and continue). For tenders that already
  exist before this ships, the watcher's startup routine (below) reconciles every tender's folder tree
  once on boot — no separate backfill migration needed, and it self-heals if a subfolder is ever
  deleted locally by accident.
- **Watcher**: new `apps/server/src/modules/tenders/local-docs/docs-watcher.service.ts` using
  `chokidar` (new dependency, `apps/server/package.json`) watching `LOCAL_DOCS_ROOT_DIR/**` with
  `awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 }` (avoids reading files mid-copy)
  and `ignoreInitial: false` (also picks up files dropped while the process was down). On each `add`
  event:
  1. Parse the path relative to the root into `[tenderFolder, maybe-subfolder, ..., filename]`.
  2. Resolve `tenderFolder` → tender via the tenderNumber-prefix lookup above; skip (log) if no match.
  3. Resolve the subfolder segment (or lack of one) → `documentType` via
     `TENDER_DOCUMENT_TYPE_FOLDER_NAMES` (case-insensitive), defaulting to `GENERAL`.
  4. Read the file, hash it, and skip (already-imported, idempotent against restarts/initial scans) if
     an attachment with that hash already exists for the tender (`attachments.repository.ts` already
     indexes `hash`).
  5. Otherwise call the exact same `attachmentsService.upload(...)` used by the manual upload path —
     `entityType: "Tender"`, `entityId`, `documentType`, no `replacesAttachmentId` (always a new
     independent lineage, consistent with part 2's multi-file model) — then
     `auditService.log({ action: "TENDER_DOCUMENT_UPLOADED", metadata: { source: "local-folder-sync" } })`.
  6. Attribution: uploads need a `uploadedById`. Add one seeded system user (`local-sync@bmp.local`,
     no login-capable role / permissions) in `packages/database/prisma/seed.ts`, used only for this
     `uploadedById` so the Documents tab clearly shows "Uploaded by Local Folder Sync" rather than
     misattributing it to whoever happened to create the tender.
- **Wiring**: started from `apps/server/src/worker.ts` (same place `startEmailWorker()` /
  `startTenderReminderWorker()` already live), guarded by a new `LOCAL_DOCS_SYNC_ENABLED` env flag
  (default `false` — opt-in, so this is a no-op everywhere except a dev machine that turns it on) and
  `LOCAL_DOCS_ROOT_DIR` (default `~/BMP-Tenders`, `~` expanded via `os.homedir()`). Both added to the
  `envSchema` in `apps/server/src/config/env.ts` following the existing `z.coerce.boolean()` /
  `z.string().default(...)` conventions. On startup (before watching begins), reconcile folders for
  every existing tender (the backfill/self-heal step mentioned above).
- **Non-goals** (explicitly out of scope for this pass): two-way sync (files uploaded via the web UI
  are not written back down to the local folder), mirroring local deletions into the app (confirmed
  with the user), real-time push to an already-open browser tab (the Documents tab picks up
  watcher-imported files on its next normal refetch, not instantly via websockets), and folder
  renaming when a tender's title changes.

## Verification

1. `pnpm --filter @bmp/server typecheck/lint/test`, `pnpm --filter @bmp/web typecheck/lint/test` —
   new unit tests for `folder-naming.ts` (folder name generation/sanitization, tenderNumber-prefix
   resolution, document-type folder mapping including the `GENERAL` fallback) and for
   `TendersService.deleteDocument`.
2. Real e2e via the dev server (already running):
   - Filename overflow: open the Documents tab on a tender, upload a file with a very long name,
     confirm it truncates instead of overflowing the card.
   - Multi-file: upload two different files under the same document type (e.g. Drawings) without
     replacing, confirm both appear as independent cards; delete one via the new trash icon and
     confirm only that lineage disappears.
   - Folder sync: set `LOCAL_DOCS_SYNC_ENABLED=true` and `LOCAL_DOCS_ROOT_DIR`, restart the worker,
     confirm the folder tree gets created for existing tenders (including the "MJ/C06/2025/3063-
     FLENGE" one), drop a file into its `BOQ/` subfolder, and confirm it shows up in the Documents tab
     within a couple seconds without any manual upload action.
