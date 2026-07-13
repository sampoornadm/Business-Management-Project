# Template-Based Document Generation (Undertaking, v1) — Design

## Problem

The owner currently produces a set of documents (Bills, Credit Notes, E-Way Bills, local
Purchase Orders, Quotations, Undertakings, Warranty/Guarantee Certificates) by hand in Word,
using a consistent company letterhead. Separately, they receive documents from others
(Drawings, GRN, MTC, Payment Advices, client Purchase Orders, Rejections) that just need
filing, not generation. This spec covers only the "documents I make" side, and only enough
of it to prove the mechanism: one document type (Undertaking), generated from a real
`.docx` template the owner maintains themselves, filled with data already in the app.

Everything else — more document types, saving generated output as a tracked attachment,
filing received documents — is deliberately deferred until this pattern is proven with a
real template and real usage.

## Goals

- A fixed, well-known location on disk where the owner places their Undertaking `.docx`
  template (which already contains their letterhead, laid out in Word, plus placeholder
  tags in the body).
- A way to see which template file is currently active for a document type (filename +
  last-modified time) without building a version-history system.
- A `POST` endpoint that fills that template with real Tender/Business/Organization data
  and returns a generated `.docx` file.
- A "Generate Undertaking" action on the Tender detail page that downloads the result.
- An initial, extensible dictionary of placeholder tags mapped to real DB fields.

## Non-goals

- **Uploading templates through the app UI.** The owner places the file directly in a
  watched-by-convention folder path; no upload endpoint, no template-management screens.
- **Version history of templates.** Only "what's there right now" is tracked (via the
  file's own mtime) — not who changed it, not prior versions, not rollback.
- **Saving generated documents as attachments.** Every generation is a fresh download;
  nothing is persisted in the database or S3. Revisit once real usage shows whether
  history/re-download matters.
- **Any document type other than Undertaking.** Bills, Quotations, Credit Notes, E-Way
  Bills, local Purchase Orders, and Warranty/Guarantee Certificates are explicitly future
  work — the owner doesn't have finished templates for most of these yet, and this spec
  exists to prove the mechanism on one real type before expanding.
- **Filing/categorizing received documents** (Drawings, GRN, MTC, Payment Advices,
  client Purchase Orders, Rejections). Separate concern, separate spec, not started here.
- **A folder-watcher/background process.** Unlike the existing tender-document
  auto-import (`docs-watcher.service.ts`), there's exactly one file at one fixed path per
  document type — the file is read fresh at generation time and whenever the "current
  template" status is checked, no watching process needed.

## Design

### Template location

One new env var, following the existing `LOCAL_DOCS_ROOT_DIR` convention exactly:

```
TEMPLATES_ROOT_DIR=~/BMP-Templates   (default, like LOCAL_DOCS_ROOT_DIR's default)
```

Each supported document type maps to a fixed filename inside that root:

```
${TEMPLATES_ROOT_DIR}/undertaking.docx
```

The owner edits this file directly in Word — their letterhead lives in the file's own
header/footer, exactly as it does today. Placing a new file at the same path replaces
"the current template"; there is no separate upload step and no database row for it.

### Placeholder tags

Templates use `{{tagName}}` (double-curly) placeholders in the body text, filled via
`docxtemplater` (new dependency — see Dependencies below). Initial dictionary, all sourced
from data the Tender detail page already loads:

| Tag | Source | Notes |
|---|---|---|
| `tenderNumber` | `Tender.tenderNumber` | |
| `tenderTitle` | `Tender.title` | |
| `tenderDepartment` | `Tender.department` | |
| `businessName` | `Tender.business.name` | the business the tender belongs to |
| `businessAddress` | `Tender.business.address` | |
| `businessGstNumber` | `Tender.business.gstNumber` | |
| `businessPanNumber` | `Tender.business.panNumber` | |
| `clientOrganizationName` | `Tender.client.name` | the tender's client org |
| `clientOrganizationAddress` | `Tender.client.address` | |
| `generatedDate` | server clock, formatted `DD-MM-YYYY` | not stored, computed at generation time |

Adding a field later means adding one entry to this dictionary (a plain object mapping
tag name to a value-getter) — no schema change, no new endpoint.

### Backend

New module `apps/server/src/modules/document-generation/`, following the standard module
convention (`*.service.ts`, `*.controller.ts`, `*.routes.ts`):

- `document-generation.service.ts`:
  - `getTemplateStatus(documentType: "undertaking"): { exists: boolean; filename: string; lastModifiedAt: string | null; path: string }` — `fs.stat`s the fixed path, used by both the missing-template error path and (later) any "which template is active" display.
  - `generateUndertaking(tenderId: string): Promise<Buffer>` — loads the tender (with `business` and `client` relations), builds the tag-value map from the dictionary above, reads the template file (throwing a clear `NotFoundError` if `getTemplateStatus` says it doesn't exist), runs it through `docxtemplater` + `pizzip`, returns the resulting `.docx` as a `Buffer`.
- `document-generation.controller.ts` / `.routes.ts`: `POST /tenders/:id/documents/undertaking`, `authenticateMiddleware` + `requirePermission("tenders:generate_document")` (new permission key, added to `packages/types/src/rbac.ts`'s matrix, granted to the roles that can already edit tenders). Response sets `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` and a `Content-Disposition: attachment` header with a filename like `Undertaking-{tenderNumber}.docx`.
- `document-generation.module.ts`: composition root, imports `tendersRepository` from the `tenders` module (sibling-module reuse, matching the existing convention) to load the tender + business + client data — no new repository needed, this module only reads.

### Frontend

- `apps/web/src/hooks/use-document-generation.ts`: `useGenerateUndertaking(tenderId)` — a mutation that calls the endpoint with `responseType: "blob"`, then triggers a browser download (temporary `<a>` element + `URL.createObjectURL`, the standard pattern for a binary-download mutation in this codebase — no existing precedent to mirror since this is the first binary-file-download button, but it's a well-known small snippet, not new infrastructure).
- A "Generate Undertaking" `Button` added to the Tender detail page's action area, gated by `hasPermission(roleName, "tenders:generate_document")`.
- Error handling: if the server returns the "template not found" error, show a toast with the exact path so the owner knows where to place the file (e.g. "Undertaking template not found. Place it at ~/BMP-Templates/undertaking.docx").

### Dependencies

- `docxtemplater` + `pizzip` (server-only, `apps/server`): the standard, actively-maintained
  combination for filling placeholder tags in an existing `.docx` file. Nothing currently
  installed does this — `mammoth` only converts docx → text/html (one-way, used for tender
  document extraction), and `pdfkit`/`exceljs` build documents from scratch rather than
  filling an existing template. This is a genuinely new capability, not a reinvention of
  something already present.

### Testing

- Unit: `document-generation.service.ts`'s tag-value-map builder (given a fake tender/
  business/organization, produces the expected plain object) — hand-written fixtures, no
  mocking framework, per this codebase's convention. `getTemplateStatus` tested against a
  temp directory (exists / doesn't exist cases), not the real `TEMPLATES_ROOT_DIR`.
- Integration: `POST /tenders/:id/documents/undertaking` against a real test template file
  checked into the test fixtures directory (not the owner's real letterhead) — asserts a
  200 with the correct content-type, and a 404-style error when the template file is
  temporarily absent (test moves it aside and restores it in `afterEach`).
- No frontend test — this is a single button triggering a file download, consistent with
  this codebase's practice of not unit-testing simple UI actions; verified manually.
