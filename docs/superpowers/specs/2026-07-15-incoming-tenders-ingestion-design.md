# Incoming Tenders Folder Ingestion — Design

## Problem

Today, turning an emailed tender document (PDF) into a real tender in the app is entirely
manual: extract fields via `POST /tenders/extract`, create the client organization if it
doesn't exist, create the tender, then separately re-run item extraction and commit a BOQ,
then attach the source document. Proven working by hand this session end-to-end (SAIL/IISCO
RFx 1400013728 → tender `1400013728`), but every step required a human (or an assistant)
driving the API directly.

The owner wants a folder they can drop a tender PDF into and have it "absorbed": tender
created, client resolved, BOQ items committed (no prices — those come later from vendor
quotes), source document attached — with placeholder values clearly flagged wherever the
document doesn't state something the schema requires.

## Goals

- One new watched folder per business: `${BUSINESSES_ROOT_DIR}/<businessCode>/incoming-tenders/`.
- Dropping a tender PDF there runs, end-to-end, automatically:
  1. Extract fields + items via the existing `TenderExtractionService` (deterministic
     SAIL/IISCO parser; LLM fallback for other formats — unchanged, reused as-is).
  2. No `tenderNumber` extracted → leave the file in place, log a warning, stop. Never guess.
  3. `tenderNumber` already exists for this business → move the file to
     `incoming-tenders/duplicates/`, log, stop. Never silently overwrite/skip without a trace.
  4. Resolve the client: `result.suggestedClientId` if the extractor found exactly one match;
     otherwise auto-create an `Organization` from `result.suggestedClientName`, `type: "PRIVATE"`
     (a required enum with no "unknown" option — always flagged, see below, not guessed silently),
     `notes: "Auto-created from incoming-tenders ingestion — verify type/GST/address."`.
  5. Create the `Tender` (`status: DRAFT`) via the existing `tendersService.create()`, using
     extracted fields. Any of the schema's required-but-unextracted fields (`estimatedCost`,
     `category`, `location`, `state`) get placeholders (`0`, `"General"`, `"Not specified"`,
     `"Not specified"`) — same convention agreed and used for tender `1400013728` — plus a
     `remarks` note listing exactly which fields are placeholders.
  6. If items were extracted, commit them as BOQ v1 via the existing bulk-commit path
     (`boqService`'s commit method — same shape as `POST /:id/boq`), no `rate` set.
  7. Move the source PDF into the new tender's `NIT` subfolder (created for free by
     `ensureTenderFolders` during step 5) — the **existing** per-tender watcher
     (`docs-watcher.service.ts`) attaches it exactly as it already does for any manually-dropped
     file. No new attachment code.
  8. Audit-log entry: `TENDER_AUTO_CREATED_FROM_INGESTION` (or similar), noting the source
     filename.

## Non-goals

- **No email/mailbox fetching** (Rediffmail or otherwise) — that remains separate, later work.
  This folder accepts files from anywhere (manually saved from an email, any source).
- **No UI toggle yet** for enabling/disabling this per business — reuses the existing
  `LOCAL_DOCS_SYNC_ENABLED` flag globally, same as the current tender-docs watcher. A
  per-business on/off toggle (from the Businesses tab, admin/superadmin-gated) was scoped
  earlier for the full email-ingestion feature; it can be layered on top of this later without
  changing this folder's processing logic.
- **No BOQ rate/pricing inference** — items are committed with description/unit/quantity only,
  matching the source document (an RFQ has no prices yet).
- **No retry/backoff logic for a document the deterministic parser doesn't recognize at all**
  (a non-SAIL/IISCO template) — falls through to the LLM extraction path exactly as
  `TenderExtractionService` already does; if that also fails to produce a `tenderNumber`, it's
  goal #2 above (leave in place, log, stop) — a human retrieves it manually, same as today.

## Design

### Folder helper (`folder-naming.ts` or a new sibling)

- New constant: `INCOMING_TENDERS_FOLDER_NAME = "incoming-tenders"`.
- `${BUSINESSES_ROOT_DIR}/<businessCode>/incoming-tenders/` created alongside `templates/` and
  `tenders/` — extend whatever already ensures those two per-business subfolders exist (created
  lazily, same as the others, no upfront provisioning needed beyond what's already there).
- `duplicates/` is a subfolder created on first use (lazily, `mkdir recursive`), not upfront.

### New watcher (`incoming-tenders.service.ts`, sibling to `docs-watcher.service.ts`)

- Same chokidar pattern, gated by the same `LOCAL_DOCS_SYNC_ENABLED`, started alongside the
  existing watcher in `worker.ts`.
- Watches `${BUSINESSES_ROOT_DIR}/<businessCode>/incoming-tenders/` for every business (loop
  `listAllBusinessIds()`, same cross-business pattern used elsewhere in this module).
- On a new file (PDF or DOCX, matching what `TenderExtractionService` already accepts):
  runs the 8-step pipeline above.
- Errors at any step (e.g. tender creation throws `ConflictError`/`BadRequestError`) are caught,
  logged, and leave the file in place (or move to a new `errors/` subfolder) — never crash the
  watcher process.

### Reused, unchanged

- `TenderExtractionService` / `extractDocumentText` / `parseIiscoHeaderFields` /
  `parseIiscoRfqItems` — zero changes.
- `tendersService.create()` — zero changes.
- BOQ commit logic — zero changes (called directly at the service layer, not via HTTP).
- `ensureTenderFolders` / per-tender `docs-watcher.service.ts` attachment watcher — zero changes.

### Testing

- Unit: the ingestion service's field-mapping/placeholder logic (given a fake extraction
  result, produces the correct `CreateTenderData` with correct placeholders and remarks note).
- Unit: duplicate-tenderNumber and no-tenderNumber-extracted paths move/leave files correctly
  against a real temp directory (same `mkdtemp` pattern as `folder-naming.spec.ts`).
- Integration: drop a real fixture PDF (a small hand-built one, or reuse the existing
  `tender-extraction.service.spec.ts` fixtures) into a temp `incoming-tenders/` dir, start the
  watcher, assert a `Tender` + `Organization` + `Boq` all get created correctly, and the file
  ends up attached under the new tender's `NIT` folder.
