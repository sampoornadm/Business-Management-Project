# Business Details & Contacts UI — Design

## Problem

The `businesses` page only lists businesses and lets you create one with `name`+`code`.
There's no way to view or edit the rest of `Business`'s fields (address, GST, Udyam, MSME
category, PAN, website, notes) or manage its contacts — even though the backend already
fully supports all of it (`GET/PATCH/DELETE /businesses/:id`, contact CRUD). This is the
first of two independent features requested together; document generation from Word
templates is scoped separately.

## Goals

- View a business's full details on a detail page (`/businesses/[id]`).
- Edit all fields (`/businesses/[id]/edit`), plus a full-page create form (`/businesses/new`)
  replacing the current name+code-only modal.
- Add/edit/delete contacts on the detail page.
- Mirror the existing `organizations` module's page structure, components, and conventions
  exactly — this is the same shape of entity (name/address/GST/website/notes/contacts),
  already solved once in this codebase.

## Non-goals

- **Member management** (`listMembers`/`addMember`/`updateMember`/`removeMember`) — those
  endpoints exist but are a separate, RBAC-flavored concern, not "business details."
  Explicitly deferred.
- **Deleting a business's `code` uniqueness handling** beyond what the existing
  `updateBusinessSchema` already validates — no new validation rules.

## Design

### Pages

- `apps/web/src/app/(dashboard)/businesses/[id]/page.tsx` — detail view, structured like
  `organizations/[id]/page.tsx`: header (name, active/inactive badge, Edit/Delete buttons
  gated on `businesses:update`/`businesses:delete`), a **Details** card (2-column grid:
  address, city, state, pincode, GST number, Udyam registration number, MSME category,
  PAN number, website, tender count), a **Notes** card (only rendered if `notes` is set),
  and a **Contacts** card (list + add/edit/delete via `ContactDialog`).
- `apps/web/src/app/(dashboard)/businesses/[id]/edit/page.tsx` — loads the business via
  `useBusiness(id)`, renders `<BusinessForm>` with its current values, submits via
  `useUpdateBusiness(id)`, redirects back to the detail page on success.
- `apps/web/src/app/(dashboard)/businesses/new/page.tsx` — same `<BusinessForm>` with empty
  defaults, submits via `useCreateBusiness()` (existing hook, body extended with the new
  fields), redirects to the new business's detail page on success.
- `CreateBusinessDialog` (the current name+code-only modal) is deleted; the businesses list
  page's "Add Business" button becomes a `Link` to `/businesses/new`, matching how
  `organizations/page.tsx` links to `/organizations/new` rather than using a modal.

### Components

- `apps/web/src/components/businesses/business-form.tsx` — new, mirrors
  `organization-form.tsx`'s shape (`BusinessForm({ defaultValues, onSubmit, isSubmitting,
  submitLabel })`). Fields: `name`, `code` (`Input`), `address`/`city`/`state`/`pincode`/
  `gstNumber`/`udyamRegistrationNumber`/`panNumber`/`website` (`Input`), `notes`
  (`Textarea`), `msmeCategory` (`Select`: Micro/Small/Medium, matching the
  `["MICRO","SMALL","MEDIUM"]` enum in `businesses.validation.ts`), `isActive` (`Switch`,
  rendered only on the edit form — a new business is always created active).
- Contacts reuse the existing `apps/web/src/components/organizations/contact-dialog.tsx`
  component as-is (it's already domain-agnostic — takes `trigger`/`contact`/`onSubmit`
  props, no "organization" string baked in) rather than forking a
  `businesses/contact-dialog.tsx` copy.

### Data layer

`apps/web/src/hooks/use-businesses.ts` gains, mirroring `use-organizations.ts`'s shapes:

- `Business` interface extended with every field the detail page needs (currently only has
  `id`/`name`/`code`/`gstNumber`/`udyamRegistrationNumber`/`msmeCategory`/`isActive`/
  `tenderCount` — add `address`/`city`/`state`/`pincode`/`panNumber`/`website`/`notes` and a
  `contacts: BusinessContact[]` array).
- `useBusiness(id)` — `GET /businesses/:id`.
- `useUpdateBusiness(id)` — `PATCH /businesses/:id`.
- `useDeleteBusiness()` — `DELETE /businesses/:id`.
- `useAddBusinessContact(id)` / `useUpdateBusinessContact(id)` / `useDeleteBusinessContact(id)`
  — `POST`/`PATCH`/`DELETE` on `/businesses/:id/contacts[/:contactId]`.
- `CreateBusinessInput` extended to accept the full field set (all optional except
  `name`/`code`), matching `createBusinessSchema`.

No backend changes — every endpoint and validation schema this needs already exists.

### Testing

- No new backend tests (no backend changes).
- Frontend: none of the sibling `organizations` components have dedicated unit tests
  either (form/dialog components are exercised via manual verification in this codebase's
  existing convention) — same here. Manual browser verification of create/view/edit/
  delete-business and add/edit/delete-contact after implementation.
