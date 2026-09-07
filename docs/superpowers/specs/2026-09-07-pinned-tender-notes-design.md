# Pinned Tender Notes — Design

Date: 2026-09-07

## Problem

`Tender.notes` (the Terms & Notes markdown-ish text captured from a tender document, rendered by
`TenderNotesView`) is long and mostly boilerplate. When actually preparing a bid, the user only
cares about a handful of lines — specific deadlines, inspection requirements, delivery terms —
and currently has no way to mark which ones matter. They want to click individual lines to "pin"
them to a dedicated section at the top, so the important instructions are visible at a glance
without re-reading the whole block every time.

## Explicitly deferred (separate project, tracked in memory)

The user's longer-term goal is to feed accumulated pins back into an AI loop that learns which
kinds of lines they tend to pin, and eventually auto-suggests (never auto-applies) similar pins on
future tenders' freshly-extracted notes. That loop can't be meaningfully designed or tested with
zero-to-a-handful of pinned examples — it needs real accumulated data first. This spec ships only
the pin/unpin mechanism and its persistence; every pin is already logged to `AuditLog` as it
happens (see below), so the data the future loop will need is accumulating from day one without
any extra plumbing. The loop itself is out of scope here.

## Current state (relevant facts, verified in code)

- `Tender.notes` is a single markdown-ish `String?` field. `TenderNotesView`
  (`apps/web/src/components/tenders/tender-notes-view.tsx`) renders it by splitting on `\n` and
  mapping each line to a block: `## `/`# ` lines become headings, `- `/`* ` lines become bullets
  (a leading `•` + the text), everything else becomes a plain paragraph line. Verified against a
  real extracted tender (1400014084): each numbered/bulleted point is already its own full line in
  the stored text (not multiple sentences glued onto one line, not split mid-sentence) — so "each
  pinnable line" already lines up with "each point," no new text-splitting logic needed.
- The closest existing precedent for a small, per-tender, creatable/deletable sub-resource is
  `TenderCompetitor` (`packages/database/prisma/schema.prisma`): its own table, `tenderId` FK with
  `onDelete: Cascade`, exposed via `POST /tenders/:id/competitors` / `PATCH .../:competitorId` /
  `DELETE .../:competitorId`, each handler in `tenders.service.ts` doing the mutation then
  returning `this.getById(tenderId, businessId)` (the full `TenderDto`) rather than just the
  created/deleted row. `TenderTag` shows the sibling `@@unique([tenderId, tagId])` shape for a
  duplicate-prevention constraint.
- `AuditService.log()` (`apps/server/src/modules/audit/audit.service.ts`) is the existing
  one-log-for-everything event log (`action`, `entityType`, `entityId`, `metadata: Json?`,
  `actorId`) — already the pattern this codebase uses for "record that something happened," per
  CLAUDE.md's own convention ("status-history-style views are just filtered reads of AuditLog, not
  new tables").
- Frontend mutation hooks for competitors (`use-tenders.ts`, `useAddTenderCompetitor` /
  `useDeleteTenderCompetitor`) follow one shape: `useMutation` posting/deleting against
  `/tenders/:id/...`, unwrapping a full `TenderDto` response, and
  `queryClient.invalidateQueries({ queryKey: ["tenders", id] })` on success — no separate pinned-
  notes fetch needed, the existing tender-detail query just gets richer.
- No `Tooltip` component exists in `packages/ui` — the codebase's existing precedent for a hover
  hint on an icon-only control is a plain `title` attribute (`tender-download-menu.tsx`'s
  `title={iconOnly ? "Download" : undefined}`, added this session). Reused here rather than adding
  a new dependency/component for one hover hint.
- The loading-spinner convention (`Loader2` + `animate-spin`, swapped in for the trigger icon while
  a mutation is pending) was just extended across the app's other mutations this session — pin/
  unpin should follow the same convention rather than reintroduce a gap that was just closed
  elsewhere.

## Data model

```prisma
model TenderPinnedNote {
  id       String @id @default(uuid())
  tenderId String
  tender   Tender @relation(fields: [tenderId], references: [id], onDelete: Cascade)
  lineText String

  pinnedById String
  pinnedBy   User   @relation(fields: [pinnedById], references: [id], onDelete: Restrict)

  createdAt DateTime @default(now())

  @@unique([tenderId, lineText])
  @@index([tenderId])
  @@map("tender_pinned_notes")
}
```

- `lineText` (the full trimmed line, exactly as rendered by `TenderNotesView` — bullet marker
  stripped the same way the renderer already strips it) is the identity, not a separate hash or a
  line-index. This is deliberate: if a tender's notes are ever re-extracted and change, pins for
  lines that no longer exist simply stop matching anything on render and quietly disappear — no
  migration, no dangling foreign reference, no broken state possible. The tradeoff (a very long
  line becomes a very long unique-constraint value) is a non-issue in Postgres, which doesn't cap
  indexed text length the way MySQL does.
- `Tender` gains a `pinnedNotes TenderPinnedNote[]` relation, included in `tenderDetailArgs`
  (`tenders.repository.ts`) the same way `competitors`/`tags` already are.

## Backend

- New repository methods on `ITendersRepository` (implemented in `TendersRepository`, same file as
  the existing competitor methods): `findPinnedNote(tenderId, lineText)` (existence check, mirrors
  `findAssignee(tenderId, userId)`), `addPinnedNote(tenderId, lineText, pinnedById)`,
  `removePinnedNote(pinnedNoteId)`, `findPinnedNoteById(id)` (for the same
  exists-and-belongs-to-this-tender ownership check `assertCompetitorBelongsToTender` already does
  for competitors — mirror that helper as `assertPinnedNoteBelongsToTender`).
- `TendersService` gains `pinNote(tenderId, lineText, actorId, businessId)` and
  `unpinNote(tenderId, pinnedNoteId, actorId, businessId)`, both following the exact shape
  `addCompetitor`/`deleteCompetitor` already use: assert the tender exists, do the mutation, call
  `AuditService.log({ action: "TENDER_NOTE_PINNED" | "TENDER_NOTE_UNPINNED", entityType: "Tender",
  entityId: tenderId, metadata: { lineText } })`, then `return this.getById(tenderId, businessId)`
  (full `TenderDto`, matching every other tender sub-resource mutation's return shape). `pinNote`
  checks `findPinnedNote` first and throws `ConflictError("This line is already pinned")` before
  inserting — the same check-then-insert shape `addAssignee` already uses for its own duplicate
  case (`findAssignee` first, not a caught DB constraint error), not a new pattern.
- Routes (`tenders.routes.ts`, same permission as every other tender-edit route,
  `tenders:update` — no new permission key):
  - `POST /tenders/:id/pinned-notes` — body `{ lineText: string }` (validated
    `z.object({ lineText: z.string().min(1).max(2000) })` in `tenders.validation.ts`, the 2000 cap
    matching how other free-text tender fields are bounded).
  - `DELETE /tenders/:id/pinned-notes/:pinnedNoteId`.
- `tenders.mapper.ts#toTenderDto` gains `pinnedNotes: entity.pinnedNotes.map(toPinnedNoteDto)`,
  where `toPinnedNoteDto` returns `{ id, lineText }` — only what the frontend needs, not
  `pinnedById`/`createdAt` (nobody asked to show who/when yet; add if that changes).
- `packages/types/src/tender.ts`: new `TenderPinnedNoteDto { id: string; lineText: string }`,
  `TenderDto.pinnedNotes: TenderPinnedNoteDto[]`, `PinTenderNoteInput { lineText: string }` (for the
  frontend's request body type, mirroring `CreateTenderCompetitorInput`'s role).

## Frontend

- `TenderNotesView` (`apps/web/src/components/tenders/tender-notes-view.tsx`) gains two new props:
  `pinnedLineTexts: Set<string>` (which lines are currently pinned, for O(1) lookup while rendering)
  and `onTogglePin: (lineText: string) => void`. Only bullet (`- `/`* `) and plain-paragraph lines
  get the hover/pin affordance — `## `/`# ` heading lines render exactly as they do today, untouched.
- Per pinnable line: wrap in a `group relative` container; on `group-hover`, a small `Pin` (or
  `PinOff`, if already pinned) icon button fades in at the line's trailing edge,
  `title={isPinned ? "Click to unpin" : "Click to pin"}`, `onClick={() => onTogglePin(lineText)}`.
  An already-pinned line keeps a small filled pin indicator visible even without hovering (not just
  on hover) — matches the design decision that pinned state should be glanceable, not something you
  have to rediscover by hovering every line.
- New component `PinnedTenderNotes` (`apps/web/src/components/tenders/pinned-tender-notes.tsx`):
  renders nothing if `pinnedNotes.length === 0`; otherwise a small "📌 Pinned" heading followed by
  each pinned line (plain text, no markdown re-parsing needed — a pinned line is never a heading)
  with its own unpin control. Rendered inside the existing Terms & Notes `Card`, above
  `TenderNotesView`, in `apps/web/src/app/(dashboard)/tenders/[id]/page.tsx`.
- New hooks in `use-tenders.ts`: `usePinTenderNote(id)` / `useUnpinTenderNote(id)`, following the
  exact `useAddTenderCompetitor`/`useDeleteTenderCompetitor` shape (mutate against
  `/tenders/:id/pinned-notes[...]`, unwrap the returned `TenderDto`, invalidate `["tenders", id]`).
  Pending state disables the clicked pin/unpin control and swaps its icon for a spinning `Loader2`,
  matching the convention just applied everywhere else this session — a toggle mid-flight can't be
  double-fired.
- Failure toast on either mutation failing, matching every other tender-mutation error-handling
  call site in this codebase (`variant: "destructive"`, message from the error or a generic
  fallback).

## RFQ integration

Pinned notes must reach vendors: when an RFQ is tied to a tender (`Rfq.tenderId`), its outbound
Request-for-Rates documents need to carry the tender's pinned lines (timelines, technical
requirements, delivery terms) — the whole point of pinning was to surface exactly this kind of
instruction so it isn't lost in the full notes block.

**Where this actually lands, given what already exists:**

- RFQ's outbound "send to vendor" channels are: a short, editable invite-email text
  (`RfqService#previewInviteVendor`/`inviteVendor`, `emailService.queueRfqEmail` — **text-only,
  no attachment support exists in the email queue at all**) and three downloadable documents (RFR
  PDF, RFR Word, and an Excel quote sheet) the user generates via the existing `RfqDownloadMenu`
  and sends themselves through whatever channel they use. Confirmed with the user: pinned notes go
  in the **PDF and Word documents only** — the invite email stays short (it already just says
  "please review the attached item list"), and the quote sheet stays a clean data-entry table.
- All three document builders already funnel through one shared private helper,
  `RfqService#loadRfrDocumentData` (`rfq.service.ts`), which — when `rfq.tenderId` is set — already
  calls `tendersRepository.findById(rfq.tenderId, businessId)` to get the tender number. That same
  call already returns `pinnedNotes` once the model above ships (same `tenderDetailArgs`
  include) — no new fetch needed, just read one more field off the tender it's already loading.
- `RfrDocumentData` (`rfq-document.ts`) gains `pinnedNotes: string[]` (plain line-text strings,
  not full `TenderPinnedNoteDto` objects — the document renderers don't need the id). `
  toRfrDocumentData(rfq, business, tenderNumber, pinnedNotes)` takes the new array (empty when the
  RFQ has no tender, or the tender has no pins) and passes it straight through.
- `buildRfrPdf()`: after the existing instructions line, if `pinnedNotes.length > 0`, render a bold
  "Important Notes" heading followed by one wrapped `doc.text()` line per pinned note (plain
  paragraph wrapping, not the row-height-computing table machinery the item table uses — these are
  prose lines, not tabular data). Renders nothing when the array is empty, matching how
  `instructionsLine`/`metaLine` already omit themselves when unset.
- `buildRfrDocx()`: `templates/rfr.docx` is a **checked-in repo file** (`git ls-files` confirms
  it's tracked, unlike the per-business Undertaking/Quotation templates under
  `BUSINESSES_ROOT_DIR`) — directly editable. Add a `{#pinnedNotes}Important Notes:{...loop
  rendering each line...}{/pinnedNotes}` block, with the heading text placed *inside* the loop tags
  so Docxtemplater skips the whole section (heading included) when the array is empty, rather than
  printing an empty heading with no content under it.

## Non-goals

- The AI feedback/auto-suggest loop (explicitly deferred above).
- True sub-line sentence splitting (explicitly decided against — pin operates on whole rendered
  lines).
- Showing who pinned a line or when, in the UI (the data exists in `AuditLog` and is cheap to add
  later; not requested now).
- Any change to how notes are extracted or how `TenderNotesView` renders non-pinnable content.
- Pinned notes in the RFQ invite-email text or the Excel quote sheet (both explicitly scoped to
  PDF/Word only, per the RFQ integration section above).
- Email attachments in general — `queueRfqEmail` has no attachment support today; adding that is a
  separate, unrelated infra change nobody asked for here.
