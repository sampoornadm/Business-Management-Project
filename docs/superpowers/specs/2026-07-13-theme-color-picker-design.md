# Theme Color Picker — Design

## Problem

BMP already supports light/dark mode (`next-themes`, `ThemeProvider`/`ThemeToggle`), but
users have no way to personalize the accent color, and there's no visual way to tell
which business's data you're currently looking at when you belong to more than one
(the multi-business foundation added an active-business switcher, but the UI looks
identical regardless of which business is active). The owner wants a Chrome-style
"pick a color" option, and — since a user can belong to multiple businesses — wants
that color to be settable per business, not just once per user, so switching business
is also visually obvious.

## Goals

- A curated swatch-grid picker (Chrome Settings-style), not a free-form color input.
- Color is scoped per `(user, business)` pair: a user who belongs to 3 businesses can
  set a different accent color for each, and the UI recolors when they switch active
  business.
- Persisted server-side (survives logout, works across devices), not just
  `localStorage`.
- No flash of the wrong color on initial page load (same problem `next-themes` already
  solves for light/dark, using the same technique).
- Reuses the existing `UserBusiness` join table and the existing
  `availableBusinesses`/`activeBusinessId` data already returned by login/refresh/
  switch-business — no new table, no new fetch on the hot path.

## Non-goals

- **Full custom hex/RGB picker.** Curated swatches only — avoids contrast-ratio
  validation entirely, since every swatch is pre-checked against both light and dark
  backgrounds.
- **Re-theming anything beyond the accent.** Only `--primary`, `--primary-foreground`,
  and `--ring` change. `--secondary`, `--muted`, `--destructive`, `--signal`, etc. stay
  fixed — this is an accent swap, not a full palette/branding system.
- **Per-business logos or other branding.** Color only.
- **Org-wide/admin-forced theme color.** This is a personal preference per membership,
  not something an admin sets for all members of a business.

## Design

### Palette

A fixed set of ~10 named swatches (e.g. `steel` (current default), `blue`, `green`,
`violet`, `amber`, `rose`, `teal`, `slate`, `indigo`, `orange`), each defining light +
dark HSL triplets for the 3 accent variables only:

```ts
// apps/web/src/lib/theme-colors.ts
export const THEME_COLORS = {
  steel: {
    light: { primary: "216 65% 34%", primaryForeground: "210 40% 98%", ring: "216 65% 34%" },
    dark: { primary: "216 65% 58%", primaryForeground: "222 47% 11%", ring: "216 65% 58%" },
  },
  // ...blue, green, violet, amber, rose, teal, slate, indigo, orange
} as const;

export type ThemeColorKey = keyof typeof THEME_COLORS;
```

`steel` is the values already in `globals.css` today, so existing users default to
today's look with no visible change until they opt into a different swatch. This file
is the single source of truth for both the picker UI (renders one swatch per key) and
the applier (below).

### Data model

```prisma
model UserBusiness {
  // ...existing fields unchanged
  themeColor String @default("steel")
}
```

One column on the existing unique `(userId, businessId)` row — no new table, no new
migration complexity beyond a default-backfilled column.

### Read path

`AvailableBusiness` (`packages/types`) gains `themeColor: string`. It's populated at
the same place all three `auth.service.ts` response-builders already assemble
`availableBusinesses` (login, refresh, `switch-business`) — one field added to an
existing mapping, no new query.

On the frontend, `auth-store.ts`'s `availableBusinesses` + `activeBusinessId` already
change on login and business-switch. A small effect (in the dashboard layout or
`ThemeProvider`) looks up the active business's `themeColor` in `THEME_COLORS` and
writes the 3 CSS custom properties onto `document.documentElement.style` whenever
either value changes. No additional network request.

### Write path

New self-scoped endpoint, following the existing own-profile/own-avatar convention
(no `requirePermission`, ownership checked in the service):

```
PATCH /users/me/theme-color
Body: { businessId: string, themeColor: ThemeColorKey }
```

Service validates the caller has a `UserBusiness` row for `businessId` (same check
`switch-business` already does), updates `themeColor` on that row, returns the updated
membership. Frontend mutation hook (`useUpdateThemeColor`) patches the cached
`availableBusinesses` array in the auth store directly (same shape as the login
response) so the new color applies immediately, no re-login/refetch needed.

### UI

New `ThemeColorPicker` component (`@bmp/ui` primitives: a `Button`-based swatch grid,
one filled circle per `THEME_COLORS` key, checkmark on the active one — same
interaction shape as `ThemeToggle`'s existing menu but rendered as a grid, not a
dropdown list, since color needs to be seen to be chosen). Added as a new section on
the existing profile page (`apps/web/src/app/(dashboard)/profile/page.tsx`), below the
profile form.

Since a user can hold multiple memberships, the section renders one swatch-grid per
entry in `availableBusinesses` (labeled with business name), not just the currently
active one — so a user can pre-set colors for businesses they aren't currently viewing,
without needing to switch into each one first.

### Flash of wrong color on load

Same class of problem `next-themes` solves for light/dark via an inline pre-hydration
script. Same fix here: on every successful apply (login, switch, or picker change),
cache `{ [businessId]: themeColor }` in `localStorage`. A small inline `<script>` in
`app/layout.tsx` (alongside `next-themes`'s own injected script) reads
`localStorage` + the last-active `businessId` synchronously and sets the 3 CSS vars
before first paint. The server-derived value (from `availableBusinesses`) reconciles
it after hydration if the cache was stale (e.g. changed on another device).

### Testing

- Unit: `THEME_COLORS` lookup/fallback (unknown/removed key falls back to `steel`),
  `theme-colors.spec.ts`.
- Unit: `users.service.ts` `updateThemeColor` — rejects a `businessId` the caller
  doesn't belong to (fake repository, no mocking framework, per existing convention).
- Integration: `PATCH /users/me/theme-color` — success case updates the row;
  403/404 case for a foreign `businessId`.
- No new E2E coverage required beyond existing profile-page smoke coverage, since this
  is additive UI on an already-tested page.
