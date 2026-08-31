# Unified Contacts (Organizations + Vendors) — Design

## Context

`OrganizationContact` and `VendorContact` are two separate, byte-for-byte-identical Prisma models
(`name`, `designation: String?`, `email: String?`, `phone: String?`, `isPrimary: Boolean`), each with
its own repository methods, mapper function, Zod schemas, routes, and a nearly-identical React dialog
component. The two dialogs have already drifted slightly (the organizations one accepts an empty-string
email, the vendors one doesn't; the organizations one's prop type is a hand-written inline interface,
the vendors one imports the real DTO) — a preview of what happens when the same shape is maintained in
two places.

The user wants: a department field (currently there is none), designation converted from free text to
a searchable dropdown with inline "add if missing", multiple phone numbers and multiple emails per
contact (each individually markable as primary — distinct from the existing per-contact `isPrimary`,
which marks a contact as an entity's primary point of contact), a notes field (a small free-text blob
per contact — currently neither table has one), a redesigned card matching an attached wireframe, and a
fuzzy (typo-tolerant) search bar across name/department/designation. This is wanted for both
Organizations (clients) and Vendors.

A third, identically-shaped model (`BusinessContact`, for a business's own office contacts) exists but
is explicitly **out of scope** — the user confirmed it should not be folded in.

Given the scale of duplication being removed and the fact both call sites need the exact same new
behavior, this collapses `OrganizationContact` + `VendorContact` into one polymorphic `Contact` model —
the same `entityType`/`entityId` convention this codebase already uses for `Attachment` and `AuditLog`
(CLAUDE.md: "an unenforced (no FK) pair of columns rather than three nullable FK columns or three
separate tables"). Unlike those two, `Contact.entityType` is a real Prisma `enum` here (not a bare
`String?`) — deliberate: `Attachment`/`AuditLog` are genuinely open-ended (any entity might get an
attachment or an audit event), but `Contact` only ever has exactly two known consumers, so a closed enum
is more type-safe with no loss of the pattern's benefit.

## Goals

- Multiple phone numbers and multiple emails per contact, each independently markable as primary.
- A `notes` free-text field per contact.
- `department` (new) and `designation` (existing, currently free text) both become searchable
  dropdowns with "add if missing" — backed by one shared, business-scoped lookup list per kind.
- One unified `Contact` model + one shared backend module + one shared frontend `ContactCard`/
  `ContactDialog`, used identically by Organizations and Vendors, replacing both existing duplicated
  implementations.
- A redesigned contact card matching the attached wireframe: name + Edit/Delete top-right, Designation
  · Department row, a phone row and an email row each showing the primary value highlighted with the
  rest listed alongside, a Notes section, spanning the full page width.
- A search bar above the contact list that fuzzy-matches (typo-tolerant) across name, department, and
  designation of the already-loaded contacts.

## Non-goals

- `BusinessContact` — explicitly excluded from this unification per the user's own decision.
- Server-side/database-backed fuzzy search (e.g. Postgres `pg_trgm`) — contact lists per business are
  small (tens, not thousands), so client-side fuzzy filtering of the already-loaded list is sufficient
  and avoids new infrastructure.
- The three other pieces of work that came out of this same conversation — the app-wide full-width page
  sweep, the app-wide clickable-email/website-link sweep, and the Organization tender-portal-URL field
  — are separate specs, built in that order after this one.
- Any change to how `AttachmentsService`/`AuditService`'s own `entityType`/`entityId` conventions work —
  `Contact` follows the same *shape* of convention but is its own independent implementation.

## Data model

```prisma
enum ContactEntityType {
  ORGANIZATION
  VENDOR
}

enum ContactLookupKind {
  DEPARTMENT
  DESIGNATION
}

model Contact {
  id          String            @id @default(uuid())
  entityType  ContactEntityType
  entityId    String
  name        String
  department  String?
  designation String?
  notes       String?
  isPrimary   Boolean           @default(false)

  phones ContactPhone[]
  emails ContactEmail[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([entityType, entityId])
  @@map("contacts")
}

model ContactPhone {
  id        String  @id @default(uuid())
  contactId String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  phone     String
  isPrimary Boolean @default(false)

  @@index([contactId])
  @@map("contact_phones")
}

model ContactEmail {
  id        String  @id @default(uuid())
  contactId String
  contact   Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)
  email     String
  isPrimary Boolean @default(false)

  @@index([contactId])
  @@map("contact_emails")
}

model ContactLookupOption {
  id         String            @id @default(uuid())
  businessId String
  business   Business          @relation(fields: [businessId], references: [id], onDelete: Cascade)
  kind       ContactLookupKind
  value      String

  createdAt DateTime @default(now())

  @@unique([businessId, kind, value])
  @@index([businessId, kind])
  @@map("contact_lookup_options")
}
```

`Organization.contacts OrganizationContact[]`, `Vendor.contacts VendorContact[]`, the
`OrganizationContact`/`VendorContact` models themselves, and their related migrations' tables are all
removed. `Business` gains `contactLookupOptions ContactLookupOption[]`.

**`isPrimary` has three independent meanings now**, all following this codebase's established
transactional single-flag convention (CLAUDE.md's "isCurrent"/this session's own "isSelected" pattern —
unset the prior flag and set the new one in the same transaction):
1. `Contact.isPrimary` — this contact is the entity's (organization's/vendor's) primary point of
   contact. Existing concept, unchanged meaning.
2. `ContactPhone.isPrimary` — this is the primary phone number *for this one contact*. New.
3. `ContactEmail.isPrimary` — this is the primary email *for this one contact*. New.

**Migration** (hand-written SQL, following this repo's established `migrate deploy`/`--create-only`
pattern for anything Prisma's auto-diff can't cleanly express — here the auto-diff *can* express the
schema, but the **data** move needs a hand-written data-migration step in the same file, same as this
session's `20260830072406_rfq_item_level_award` migration did for its `AWARDED`→`CLOSED` move):

```sql
-- 1. Create Contact from every OrganizationContact.
INSERT INTO contacts (id, "entityType", "entityId", name, department, designation, notes, "isPrimary", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'ORGANIZATION', "organizationId", name, NULL, designation, NULL, "isPrimary", "createdAt", "updatedAt"
FROM organization_contacts;

-- 2. One ContactPhone per OrganizationContact that had a non-empty phone, marked primary.
INSERT INTO contact_phones (id, "contactId", phone, "isPrimary")
SELECT gen_random_uuid(), c.id, oc.phone, true
FROM organization_contacts oc
JOIN contacts c ON c."entityId" = oc."organizationId" AND c."entityType" = 'ORGANIZATION' AND c.name = oc.name AND c."createdAt" = oc."createdAt"
WHERE oc.phone IS NOT NULL AND oc.phone <> '';

-- 3. One ContactEmail per OrganizationContact that had a non-empty email, marked primary.
INSERT INTO contact_emails (id, "contactId", email, "isPrimary")
SELECT gen_random_uuid(), c.id, oc.email, true
FROM organization_contacts oc
JOIN contacts c ON c."entityId" = oc."organizationId" AND c."entityType" = 'ORGANIZATION' AND c.name = oc.name AND c."createdAt" = oc."createdAt"
WHERE oc.email IS NOT NULL AND oc.email <> '';

-- 4-6. Repeat 1-3 for vendor_contacts with entityType = 'VENDOR' and entityId = "vendorId".

DROP TABLE organization_contacts;
DROP TABLE vendor_contacts;
```

The join on `(entityId, entityType, name, createdAt)` (rather than reusing the old row's own id as the
new `Contact.id`) is deliberate: `Contact.id` is a fresh `gen_random_uuid()`, not the old contact's id,
since the plan should not assume the old and new ids are interchangeable anywhere downstream. If two
contacts on the exact same organization somehow share both `name` and `createdAt` (practically
impossible — `createdAt` has microsecond precision and is set by the original insert), the join would
ambiguously match both; the implementation plan should verify this is safe against real data (e.g. by
checking for such collisions before running the migration) or key the join on the old row's own `id`
carried through as a temporary column instead, whichever the plan's author finds cleaner once writing
the actual migration file.

## Backend changes

**New module** `apps/server/src/modules/contacts/` (`contacts.repository.ts`, `.service.ts`,
`.mapper.ts`, `.module.ts` — no dedicated `.controller.ts`/`.routes.ts` of its own for the
create/update/delete-contact actions, since those stay mounted under the existing
`/organizations/:id/contacts` and `/vendors/:id/contacts` paths; see below):

- `IContactsRepository`: `findByEntity(entityType, entityId): Promise<ContactWithChildren[]>`,
  `create(data): Promise<void>`, `update(id, data): Promise<void>`, `delete(id): Promise<void>`,
  `belongsToEntity(contactId, entityType, entityId): Promise<boolean>`, `listLookupOptions(businessId,
  kind): Promise<string[]>`, `upsertLookupOptionIfMissing(businessId, kind, value): Promise<void>`
  (transactional — this is the "add in place" persistence: called automatically whenever a contact is
  saved with a `department`/`designation` value not already in that business's lookup list, not via a
  separate user-facing "confirm add" API call).
- `ContactsService`: enforces the transactional single-`isPrimary`-per-scope rule for all three
  `isPrimary` meanings above (unset-then-set in one `prisma.$transaction`, exactly mirroring this
  session's own `RfqQuote.isSelected` implementation in `rfq.repository.ts`); on
  `createContact`/`updateContact`, calls `upsertLookupOptionIfMissing` for any non-empty
  `department`/`designation` value. `updateContact`'s `phones`/`emails` arrays are a **full replace**,
  not a diff/upsert: when either array is present in the update payload, delete that contact's existing
  `ContactPhone`/`ContactEmail` rows and recreate from the submitted array, all in one transaction. This
  is why `CreateContactInput`/`UpdateContactInput`'s phone/email entries carry no `id` — the frontend
  always submits the complete current list, never a partial diff, avoiding the need for per-row
  create/update/delete reconciliation for what's realistically a 1-4-item list per contact.
- `contacts.module.ts` exports `contactsRepository`/`contactsService` as singletons, following this
  repo's documented cross-module reuse convention (`organizations.module.ts`/`vendors.module.ts`
  currently `import { auditService } from "../audit/audit.module.js"` — they'll additionally `import
  { contactsRepository } from "../contacts/contacts.module.js"` and inject it into
  `OrganizationsService`/`VendorsService`'s constructors).

**`organizations.repository.ts`/`vendors.repository.ts` changes:** `organizationWithContacts`/
`vendorWithContacts`'s `include: { contacts: {...} }` can no longer work as a Prisma relation include
(`Contact` has no direct FK back to `Organization`/`Vendor`) — this breaks `OrganizationWithContacts`/
`VendorWithContacts`'s current Prisma-inferred-type pattern. Fix: drop `contacts` from both include
objects (rename to plain `organizationArgs`/`vendorArgs` — no more "WithContacts" since they no longer
carry it structurally), and add a `contacts: ContactDto[]` field composed separately:
- `findById`: after fetching the org/vendor row, separately call
  `contactsRepository.findByEntity("ORGANIZATION", id)` and attach.
- `findMany` (paginated list): **do not** fetch contacts at all — confirmed via the mapper
  (`toOrganizationListItemDto`/equivalent) that the list DTO never reads `.contacts` today; only the
  single-entity detail DTO does. This is a **de-scoping**, not a regression: list rows currently fetch
  contacts (via the shared include) and then never use them.
- `create`: newly created org/vendor always has zero contacts (contacts are only ever added via the
  separate `addContact` endpoint) — return `contacts: []` directly, no query needed.
- `update`: doesn't touch contacts, but callers may rely on the returned DTO reflecting current state —
  fetch contacts the same way `findById` does, don't assume `[]`.
- `createContact`/`updateContact`/`deleteContact` on `OrganizationsService`/`VendorsService` delegate
  the actual row mutation to the new `contactsRepository`/`contactsService` (passing
  `entityType: "ORGANIZATION"`/`"VENDOR"`), keep their existing `assertContactBelongsToOrg`-style
  ownership check (now via `contactsRepository.belongsToEntity`), keep the exact same audit-log calls
  and "re-fetch and return the full parent DTO" pattern they use today — this preserves every existing
  route/permission/response-shape contract (`organizations:update`/`vendors:update`,
  `POST/PATCH/DELETE /organizations/:id/contacts(/:contactId)`, same for vendors) with zero frontend
  hook URL changes.

**New endpoint**: `GET /contacts/lookup-options?kind=DEPARTMENT|DESIGNATION` (business-scoped via the
caller's active business from auth context, gated on plain `authenticateMiddleware` — no extra
permission, matching the low sensitivity and universal-read nature of `organizations:read`/
`vendors:read`, which every role already has via `TENDER_VIEW_BASELINE`). No create/add endpoint — "add
in place" is a side effect of saving a contact, not a separate round trip.

**`packages/types/src/contact.ts`** (new, shared file — replacing the duplicated
`OrganizationContactDto`/`VendorContactDto`/`CreateOrganizationContactInput`/etc. pairs in
`organization.ts`/`vendor.ts`):

```typescript
export interface ContactPhoneDto { id: string; phone: string; isPrimary: boolean; }
export interface ContactEmailDto { id: string; email: string; isPrimary: boolean; }
export interface ContactDto {
  id: string;
  name: string;
  department: string | null;
  designation: string | null;
  notes: string | null;
  isPrimary: boolean;
  phones: ContactPhoneDto[];
  emails: ContactEmailDto[];
  createdAt: string;
}
export interface CreateContactInput {
  name: string;
  department?: string;
  designation?: string;
  notes?: string;
  isPrimary?: boolean;
  phones: { phone: string; isPrimary: boolean }[];
  emails: { email: string; isPrimary: boolean }[];
}
export type UpdateContactInput = Partial<CreateContactInput>;
export const CONTACT_LOOKUP_KINDS = ["DEPARTMENT", "DESIGNATION"] as const;
export type ContactLookupKind = (typeof CONTACT_LOOKUP_KINDS)[number];
```

`OrganizationDto`/`VendorDto` both change their `contacts` field's type from
`OrganizationContactDto[]`/`VendorContactDto[]` to the shared `ContactDto[]`.

**`rfq.service.ts`'s `pickPrimaryContact`/`loadInviteVendorContext`** (the one other consumer of
`vendor.contacts` in the codebase, added this session's own RFQ plan): update to pick a primary email
from the array. Add a small shared helper (e.g. in `rfq.service.ts` itself, or a shared util if it
turns out to be needed by more than one call site) —
`pickPrimary<T extends { isPrimary: boolean }>(items: T[]): T | undefined => items.find((i) =>
i.isPrimary) ?? items[0]` — used both to pick the primary contact among a vendor's contacts (unchanged
logic, just now against the new `ContactDto[]` shape) and to pick the primary email among that
contact's `emails[]`. `loadInviteVendorContext`'s existing guard (`if (!contact?.email)`) becomes
`if (!primaryEmail?.email)`, and both downstream non-null-assertion call sites (`contact.email!`) use
the resolved `primaryEmail.email` instead.

## Frontend changes

**New `packages/ui` component** `combobox.tsx` — single-select, filterable, with an "Add '<query>'"
row when the typed text doesn't exactly match any option (case-insensitive) and the query is non-empty.
Modeled directly on `multi-select.tsx`'s existing structure (same `@radix-ui/react-popover` primitive —
this package has no `cmdk`/Command primitive to build on instead — same `cn()` usage, same Tailwind
class patterns, a plain `<input>` filter box, `align="start" sideOffset={4}`), but single-select
(clicking an option or the "Add" row closes the popover and sets the one value) instead of toggling
a multi-value array. Exported from `packages/ui/src/index.ts` following the file's existing flat
`export * from "./components/<name>";` list convention.

**Fuzzy matching**: add `fuzzysort` (small, zero-dependency) to `apps/web`'s `package.json` — confirmed
genuinely absent from the whole monorepo today, including transitively. Used only for the new contacts
search bar's client-side filtering across `name`/`department`/`designation` of the already-loaded list.

**New shared components** in `apps/web/src/components/contacts/`:
- `contact-card.tsx` — redesigned per the wireframe: name + `isPrimary` badge + Edit/Delete buttons in
  the header row; a Designation · Department line; a phone section (primary phone visually highlighted
  — e.g. bold + a filled icon — with any additional phones listed alongside in a lighter style); an
  email section (same treatment, primary email rendered as a `mailto:` link per the follow-up link-sweep
  spec, though that's technically a separate piece of work — doing it here for emails specifically costs
  nothing extra since the card is being built fresh); a Notes section (only rendered when notes is
  non-empty). Card wrapper spans the full available width (no `max-w-*` constraint of its own — the
  *page's* `max-w-3xl` wrapper is a separate, pre-existing constraint on both the organizations and
  vendors detail pages, called out as part of the app-wide full-width sweep spec that follows this one,
  not fixed here to keep this spec's diff scoped to the contacts feature itself).
- `contact-dialog.tsx` — replaces both existing near-duplicate dialogs. Fields: name (text), Department
  (the new `Combobox`, options from `GET /contacts/lookup-options?kind=DEPARTMENT`), Designation (same,
  `kind=DESIGNATION`), a repeatable phone-number list (add/remove rows, one radio-style "primary"
  selector across the list — reusing this session's own `QuoteCell`-style small selectable-button
  pattern is overkill here; a plain radio group is simpler and this form has no pre-existing convention
  to match), a repeatable email list (same), notes (`Textarea`), and the existing "Primary contact"
  checkbox. Replaces the current Zod schema's org/vendor inconsistency (org tolerates `""` for email,
  vendor doesn't) with one shared schema where each phone/email list entry requires a non-empty value
  when present — an *empty list* (zero phones or zero emails) is how "no phone on file" is now
  expressed, removing the need for the empty-string special case entirely.
- `contact-search-bar.tsx` — a search `Input` above the contact list; filters the already-loaded
  `contacts` array client-side via `fuzzysort.go(query, contacts, { keys: ["name", "department",
  "designation"] })`-style matching (exact API to be confirmed against `fuzzysort`'s real interface when
  implementing).

**`apps/web/src/hooks/use-organizations.ts`/`use-vendors.ts`**: `useAddOrganizationContact`/
`useUpdateOrganizationContact`/`useDeleteOrganizationContact` (and the vendors equivalents) keep their
exact current names, URLs, and cache-invalidation behavior — only their input/output TypeScript types
change (`CreateContactInput`/`ContactDto` from the new shared `@bmp/types` module instead of the
per-module duplicated types).

**`apps/web/src/app/(dashboard)/organizations/[id]/page.tsx`/`vendors/[id]/page.tsx`**: the Contacts
`Card`'s inline row-rendering JSX (the `{[contact.designation, contact.email, contact.phone]...join(" ·
")}` line and its siblings) is replaced by `<ContactSearchBar>` + a list of `<ContactCard>`, each
wired to the existing `addContact`/`updateContact`/`deleteContact` mutations exactly as today (only the
JSX changes, not the mutation wiring).

## Testing considerations

- Transactional `isPrimary` flips: three separate unit tests (one per meaning above), each asserting
  that setting a new primary clears exactly one prior flag within the correct scope (e.g. setting a
  new primary phone on contact A must never affect contact B's primary phone).
- `upsertLookupOptionIfMissing`: integration test that saving two contacts with the same new department
  value results in exactly one `ContactLookupOption` row (not two), and that the unique constraint
  (`businessId, kind, value`) is what enforces this, not just application-level luck.
- Migration: a fixture-based test (mirroring this session's own RFQ migration test) inserting a
  synthetic `organization_contacts`/`vendor_contacts` row with a phone and an email, running the
  migration, and asserting the resulting `Contact`/`ContactPhone`/`ContactEmail` rows match.
- `rfq.service.ts`'s `pickPrimaryContact`/`loadInviteVendorContext`: existing tests for "vendor has no
  contact email on file" must still pass against the new `emails: []` shape (empty array, not `null`
  email).
- Frontend: no dedicated component tests exist for the current contact dialogs in this codebase, so
  none are required here either, matching established convention — implementation should rely on the
  existing manual/live-browser verification pattern this session has used throughout for UI work.

## Open questions for the implementation plan

- The migration's `JOIN ... ON ... name = oc.name AND createdAt = oc.createdAt` matching strategy
  (see Data model section) should be verified against real data for uniqueness before being finalized,
  or replaced with a temporary carried-through old-id column if the plan's author prefers not to rely
  on it.
- Exact `fuzzysort` API usage (its real function signatures) should be confirmed against the installed
  package version when writing the frontend task, not assumed from memory.
