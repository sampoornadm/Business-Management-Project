# Bid form auto-fill for the mjunction portal

## Context

Filling the mjunction bid form by hand for a tender (e.g. 1400014359, SAMSON) means re-typing data BMP already holds. The form has rate-per-BOQ-line fields, header fields, document uploads and many dropdowns. The portal's own saved-data dropdown can't be clicked, and browser plugins and headless loading are blocked, so the usual tricks fail. Goal: populate the form quickly from the DB. The user clicks Submit (bids are binding; the tool never submits).

Repo facts (from exploration): there is no portal code, credential store or server-side browser automation today. Bid data already exists: `Tender`, current `Boq`/`BoqItem` (rate, quantity, gstRate, hsnCode), `RfqQuote`, `Business` (GST/PAN/address/bank), the quotation generator (`modules/document-generation/quotation-document.ts`) and the undertaking .docx. Missing: delivery period, payment terms, the portal's own `MJ/...` reference, and a signatory.

## Approach: decide by evidence, in this order

The right method depends on how the portal actually submits, so step 1 is a no-code investigation. Pick the first option that works.

1. **Replay the portal's own HTTP calls** (best: fastest, device-independent, shippable). Needs the portal to submit via XHR/form POST with data we can construct.
2. **Drive a real, visible Chrome over CDP** (Playwright `connectOverCDP` to the user's own Chrome started with `--remote-debugging-port`). It is the user's real profile, session and fingerprint, so there is no headless detection and no plugin needed. Set values with the page's own events (`page.fill`, `selectOption`, or `evaluate` plus dispatched `input`/`change`) instead of simulated clicks where clicks are blocked.
3. **Fallback: a paste-ready sheet.** Generate a per-tender fill sheet (rates in portal row order, header values, files pre-named) plus OS-level keystroke or clipboard helpers. Slower, always works.

## Step 0 - Investigation (the user offered to show the page)

Ask the user to give us, for tender 1400014359 on a throwaway or already-submitted tender:
- A HAR export from Chrome DevTools, Network tab, "Preserve log", while manually filling and saving (not submitting) the form. Redact the session cookie. It shows whether option 1 is possible.
- Screenshots or saved HTML of each form page, showing which fields exist and which dropdowns, and the page's field `id`/`name` values.
- Whether saving a draft exists on the portal (a safe place to land the fill).

Outputs: a field map (portal field to BMP source) and the decision between options 1 and 2.

## Step 1 - Field mapping module (works for any option)

New module `apps/server/src/modules/portal-bid/` following the repo conventions (repository/service/controller/routes/validation/module):
- `bid-payload.service.ts`: builds one canonical `BidPayload` from the DB for a tender: header fields, an ordered list of `{ portalRowKey, itemCode, rate, gstRate, hsnCode, make, model }` from the current BOQ (rates computed server-side, same recompute-on-read rule as elsewhere), and the files to upload (reuse the quotation and undertaking generators; do not fork them).
- `mjunction.mapping.ts`: the single place that maps `BidPayload` to portal field keys. Row matching goes by BOQ item code or description, with a clear error for any row the portal has that BMP lacks.
- Gaps to fill: add the missing tender/business fields (delivery period, payment terms, signatory) to the schema only if the form needs them (Step 0 decides). Add an `rbac.ts` permission such as `tenders:fill-portal`, then re-run `pnpm db:seed`.
- `GET /tenders/:id/portal-payload` returns the payload for preview and for any client that fills the form.

## Step 2 - Filler (option 2 shape; option 1 swaps the transport)

A small standalone runner, not the Express API:
- `apps/server/src/modules/portal-bid/filler/` using Playwright over CDP, with a dry-run mode that logs what it would set, and a post-fill verification pass that reads every field back and diffs it against the payload.
- Runs on the user's Mac first (CLI: `pnpm portal:fill --tender 1400014359`; the user logs into the portal themselves in the Chrome it attaches to). No portal password is stored anywhere.
- For a shipped, device-independent build, the same runner is packaged as a small local companion app that the web UI triggers (a "Fill bid on portal" button beside `TenderDownloadMenu` in `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`, gated by `hasPermission`). Decide this only after the CLI works. If option 1 works, the web app can run it from the server and no companion is needed.
- Audit each run through `AuditService.log` (`TENDER_PORTAL_FILL_STARTED`/`_COMPLETED`, with a count of fields set and a list of mismatches). Never log credentials or the session cookie.

## Not in scope
Auto-submit, storing portal credentials, bypassing the portal's authentication or CAPTCHAs, and other portals. The tool fills the form for a user who is already logged in.

## Verification
- Unit tests (Vitest, fake repositories) for `bid-payload.service.ts` and the mapping: rate/total match the BOQ, an unmatched portal row errors, missing optional fields are flagged.
- Dry-run against the real tender 1400014359: payload printed, diff against the portal screenshots by eye.
- Live fill on the portal's draft/test state, then the read-back diff reports zero mismatches. The user reviews and submits.
- `pnpm typecheck && pnpm lint && pnpm test` clean.
