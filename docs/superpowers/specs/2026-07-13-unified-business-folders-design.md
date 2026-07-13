# Unified Per-Business Folder Structure — Design

## Problem

Two features currently use two separate, business-agnostic local folder roots:

- **Document generation** (just shipped): one flat template file per document type at
  `${TEMPLATES_ROOT_DIR}/undertaking.docx` — but the owner runs multiple businesses (Archie
  Udyog, Samson Industries), each with its own letterhead. A single flat path can't hold
  more than one business's template.
- **Tender document auto-import** (existing, already live): `${LOCAL_DOCS_ROOT_DIR}`
  (`~/BMP-Tenders`) holds one folder per tender, flat, with no business segment — the
  watcher resolves a dropped file to a tender by searching every business for a matching
  `tenderNumber`. This is real, in-use infrastructure: `LOCAL_DOCS_SYNC_ENABLED=true` in
  this environment, and `~/BMP-Tenders` currently holds 56 real tender folders.

The owner wants both to live under one shared root, containerized per business, so the
folder structure on disk mirrors the app's own business boundaries:

```
~/BMP-Businesses/
  ├── ARCHIE/
  │   ├── templates/
  │   │   └── undertaking.docx
  │   └── tenders/
  │       └── TEN-001 - Some Tender Title/
  │           ├── Correspondence/
  │           ├── Drawings/
  │           └── ...
  └── SAMSON/
      ├── templates/
      └── tenders/
```

## Goals

- One env var, `BUSINESSES_ROOT_DIR` (default `~/BMP-Businesses`), replacing both
  `TEMPLATES_ROOT_DIR` and `LOCAL_DOCS_ROOT_DIR`.
- Document-generation template path becomes `${BUSINESSES_ROOT_DIR}/<businessCode>/templates/undertaking.docx`.
- Tender-folder auto-import path becomes `${BUSINESSES_ROOT_DIR}/<businessCode>/tenders/<tenderFolder>/...`.
- The watcher resolves a dropped file's business **directly from the path** (the
  business-code segment) rather than searching every business for a matching tender
  number — strictly more correct than today's cross-business search, and a nice
  side-effect simplification, not just a rename.
- A one-time, safe migration for the 56 real folders currently under `~/BMP-Tenders`:
  resolve each to its owning business via the database, then **move** it to
  `${BUSINESSES_ROOT_DIR}/<businessCode>/tenders/<folder>`. Must support `--dry-run`
  (prints the plan, moves nothing) before the real run. Any folder that doesn't resolve to
  a known tender is reported, never silently skipped or deleted.
- After migration, the now-empty `~/BMP-Tenders` directory is removed automatically.

## Non-goals

- **No change to per-tender subfolder structure** (`Correspondence`/`Drawings`/etc.) — only
  a business-code + `tenders` segment is added above the existing tender-folder naming.
- **No UI for managing this folder structure** — still filesystem-only, no upload UI, no
  database table, matching both source features' existing designs.
- **No change to which document types get auto-imported, or how contacts/attachments are
  stored** — purely a path/lookup restructuring.
- **No retroactive re-scoping of already-imported `Attachment` rows** — those already
  correctly reference their `Tender`/business via `entityId`; only the on-disk folder
  location and the live watcher's lookup path change, not historical data.

## Design

### Env var

Replace, in `apps/server/src/config/env.ts`:
```
LOCAL_DOCS_ROOT_DIR: z.string().default("~/BMP-Tenders")
TEMPLATES_ROOT_DIR: z.string().default("~/BMP-Templates")
```
with:
```
BUSINESSES_ROOT_DIR: z.string().default("~/BMP-Businesses")
```
`LOCAL_DOCS_SYNC_ENABLED` (the opt-in gate for the watcher) is unchanged — it only toggles
whether the watcher process runs, not where it looks.

### Folder helpers (`folder-naming.ts`)

- `tenderFolderName`/`documentTypeForFolder`/`expandHome` are unchanged.
- `ensureTenderFolders(rootDir, tender)` becomes `ensureTenderFolders(rootDir, businessCode, tender)`,
  building `path.join(expandHome(rootDir), businessCode, "tenders", tenderFolderName(tender))`.
- New: `ensureBusinessTemplatesFolder`-style path helper (or reuse from
  `document-generation.service.ts`, see below) building
  `path.join(expandHome(rootDir), businessCode, "templates")`.

### Watcher (`docs-watcher.service.ts`)

- `listAllTendersForFolderSync()` returns tenders **with their business's code** attached
  (already loops per-business; each iteration already knows the `businessId`, just also
  fetch/attach that business's `code`).
- `reconcileFolders` passes the business code through to `ensureTenderFolders`.
- Chokidar's `depth` option increases from `3` to `5` (two new path segments —
  `<businessCode>/tenders/` — sit above what was previously the root).
- `importFile`'s path parsing changes: `relative.split(path.sep)` now starts with
  `[businessCode, "tenders", tenderFolder, subfolder?, ...]`. Resolve `businessCode` to a
  `businessId` via `prisma.business.findUnique({ where: { code } })`, then look up the
  tender **scoped directly to that business** (`prisma.tender.findFirst({ where:
  { tenderNumber, businessId } })`) instead of the current
  `findTenderByNumberAcrossBusinesses` cross-business search — the path now carries the
  business unambiguously, so the search-every-business workaround is no longer needed for
  files following the new structure.
- A file dropped with an unrecognized business-code segment (folder name doesn't match any
  `Business.code`) is logged and skipped, same "no match, skip and log" pattern the code
  already uses for an unrecognized tender-folder name.

### Document generation (`document-generation.service.ts`)

- `getTemplatePath`/`getTemplateStatus` take a `businessCode` parameter:
  `path.join(expandHome(env.BUSINESSES_ROOT_DIR), businessCode, "templates", "undertaking.docx")`.
- `generateUndertaking` passes `tender.business.code` through (one more field added to the
  existing `tenderDocGenArgs` Prisma select in `tenders.repository.ts`, which already pulls
  `business.name`/`address`/`gstNumber`/`panNumber`).
- The "template not found" error message names the business: *"Undertaking template not
  found for ARCHIE. Place it at ~/BMP-Businesses/ARCHIE/templates/undertaking.docx"*.

### Tender creation (`tenders.service.ts`)

- `TendersService` gains `businessesRepository` as a constructor dependency (same
  cross-module-reuse convention `tenders.module.ts` already uses for
  `organizationsRepository`/`usersRepository`), used only to look up the creating
  business's `code` right before calling `ensureTenderFolders`.

### Migration script

A one-off script (`packages/database/scripts/migrate-tender-folders.ts` or similar,
invoked via `tsx`, matching the existing `seed.ts` convention), run manually once:

1. Reads every entry directly under the current `LOCAL_DOCS_ROOT_DIR`-shaped root
   (hardcoded to the pre-migration default path, since by the time this runs the env var
   will already point at the new root).
2. For each entry, parses the tender number via the existing `tenderNumberFromFolderName`,
   looks it up via `findTenderByNumberAcrossBusinesses` (the existing cross-business
   search — appropriate here since these old folders carry no business segment yet) to
   find its owning business.
3. With `--dry-run` (default without an explicit `--execute` flag): prints every planned
   `mkdir` + move, and every folder that couldn't be resolved to a tender, without
   touching the filesystem.
4. With `--execute`: performs the moves for real (`fs.rename`, or copy+delete across
   filesystems as a fallback), creating the destination business/`tenders` subfolders as
   needed.
5. After every real entry has been moved successfully, removes the now-empty original
   root directory.
6. Any folder that fails to resolve to a tender is left in place and reported at the end
   (both dry-run and execute) — never deleted or moved blindly.

### Testing

- Unit: `folder-naming.ts`'s updated `ensureTenderFolders` signature (business code in the
  built path) — filesystem test against a temp directory, same pattern as
  `document-generation.service.spec.ts`'s existing temp-dir tests.
- Unit: `docs-watcher.service.ts`'s `importFile` path-parsing logic for the new segment
  layout, and the business-code-to-businessId resolution (fake Prisma-shaped fixtures,
  hand-written, no mocking framework).
- Unit: the migration script's planning logic (given a fake directory listing + fake
  tender-lookup results, produces the correct planned moves) — the actual `fs.rename`
  calls are integration-level, exercised manually against a scratch directory during
  verification, not against the owner's real 56 folders in an automated test.
- Integration: `document-generation.integration.spec.ts` updated for the new
  business-scoped template path.
- Manual verification (owner's real environment): run the migration script with
  `--dry-run` first, review the plan, then `--execute` once satisfied — this is real data,
  not something to automate away the review step for.
