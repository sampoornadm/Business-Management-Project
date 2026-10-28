# Bundled portal browser (Chromium) for the SAIL ISP bid fill

## Context

The Fill portal bid feature (merged, commit 605eff0) works only if the user first starts their own Chrome with `--remote-debugging-port=9222`, logs in, and opens the bid response. That is a manual step, it leaves an open TCP debug port on the machine, and it does not ship. Goal: BMP launches its own Chromium window itself, keeps a persistent portal login in a profile folder, and the existing fill code drives that window. Self-hosted means the server runs on each user's own PC (Windows and Mac), so a real window can open on their desktop (decided with the user). A Docker/office-server deployment cannot open a window on a user's desktop and is explicitly out of scope; document that.

User decisions: use **Chromium** (not branded Chrome); **plain Chromium window with tabs** (the portal opens popups and new tabs); the user wants to **see how it looks, especially on Windows**.

## Approach

Playwright (`playwright-core` 1.61.1 is already a dependency) `chromium.launchPersistentContext(profileDir, { headless: false })`. A launched browser talks to the app over a pipe, so no debug port is opened (also no Windows Firewall prompt). Everything after the browser exists (`PortalSession.findIn`, `fillBid`, the job service, the UI) is unchanged.

### 1. `PortalBrowser` manager (new) - `apps/server/src/modules/portal-bid/portal/portal-browser.ts`
- Singleton owned by `portal-bid.module.ts`; holds the one live `BrowserContext`.
- `open()`: idempotent. If the context is alive, `bringToFront()` the portal page; else launch persistent context and go to `PORTAL_URL` (default `https://srm.sailisp.co.in`).
- Launch options (look and feel): `headless: false`, `viewport: null` (window sizes itself, no fixed emulated viewport), `args: ["--start-maximized", "--no-first-run", "--no-default-browser-check"]`, `ignoreDefaultArgs: ["--enable-automation"]` (removes the "controlled by automated test software" bar), `executablePath` only if `PORTAL_BROWSER_PATH` is set.
- Profile dir: `PORTAL_BROWSER_DIR`, default `path.join(os.homedir(), ".bmp-portal-browser")` (use `os.homedir()`, not `$HOME`, so Windows resolves `C:\Users\<name>\...`).
- `context.on("close")` clears the singleton so a closed window reads as "not open".
- `session()`: `PortalSession.findIn(context.pages())` or null. Add `status()` returning `{ open, onResponsePage, rfxNumber?, responseNumber? }`.
- Injectable launcher (constructor arg) so unit tests use a fake, same as the repo's hand-written-fake convention.

### 2. Wire it in
- `PortalSession` (portal-session.ts): `disconnect()` already no-ops when `browser` is unset; managed sessions come from `findIn`, which never sets it, so a fill never closes the user's window. Add a test pinning that.
- `portal-bid.module.ts`: runner `attach` = managed `portalBrowser.session()` first; fall back to `PortalSession.attach(PORTAL_CDP_URL)` only if `PORTAL_CDP_URL` is set. Clear error when neither: "Open the portal browser, log in, and open the bid response first".
- `config/env.ts`: move the raw `process.env.PORTAL_CDP_URL` read in as optional validated vars: `PORTAL_URL`, `PORTAL_BROWSER_DIR`, `PORTAL_BROWSER_PATH`, `PORTAL_CDP_URL`.
- CLI scripts (`portal-fill.ts`, `portal-action.ts`, `portal-profile-import.ts`) keep CDP: they are separate processes and cannot reach the server's window. Note this in the docs.

### 3. API + UI
- `POST /portal-bids/browser/open` and `GET /portal-bids/browser/status` in `portal-bid.routes.ts` / controller, both `tenders:fill_portal`, with `@openapi` blocks like the existing routes.
- `packages/types/src/portal-bid.ts`: `PortalBrowserStatusDto`.
- Web: `use-portal-bids.ts` gets `useOpenPortalBrowser()` and `usePortalBrowserStatus()`; a new "Open portal browser" outline button beside "Fill portal bid" on the tender page (`tenders/[id]/page.tsx`, gated by `tenders:fill_portal`); toast "Log in and open your bid response in the window that opened". The Fill dialog's failure text already shows the server message.

### 4. Shipping the browser
- Root script `portal:browser:install`: `pnpm --filter @bmp/server exec playwright-core install chromium` (works on Windows, downloads the win64 build).
- To ship inside the app folder, set `PLAYWRIGHT_BROWSERS_PATH` to a short path inside the install dir (e.g. `.\browsers`) before the install and at run time. Keep it short: Windows MAX_PATH (260) breaks deep paths.
- Not Google Chrome: its licence forbids redistribution. Chromium is fine. Optional fallback for locked-down Windows PCs: `PORTAL_BROWSER_PATH` pointing at Edge (also Chromium), no download.
- Windows notes for the docs: Playwright's Chromium is unsigned, so SmartScreen/antivirus may prompt on first launch (allow-list the browsers folder); the profile folder holds the portal session cookies, treat it like a browser profile; pin and periodically bump the Playwright version for browser security fixes.

### 5. Seeing how it looks (Windows concern)
- `pnpm portal:browser` script: calls the same `open()` used by the server, so what you see is what ships.
- Mac: after building, I launch it and send a real screenshot (`screencapture`).
- Windows: I cannot run Windows here. Add `.github/workflows/portal-browser-preview.yml` (`workflow_dispatch`, `windows-latest`): installs Chromium, launches with the same options, takes a full-screen PowerShell screenshot, uploads it as an artifact. Needs a push to GitHub (the user pushes; my push was blocked earlier). The user can also run `pnpm portal:browser:install && pnpm portal:browser` on a Windows PC.

## Tests
- `portal-browser.spec.ts` (fake launcher): open is idempotent, close resets state, `session()` null when closed, status shape, launch options include `headless: false` and `ignoreDefaultArgs`.
- `portal-session.spec.ts`: a session from `findIn` does not close the browser on `disconnect()`.
- One real-Chromium test `it.skipIf(!hasChromium)` launching headless with a temp profile (existing session tests already launch Chromium, same pattern).
- Server `tsc`, `eslint`, vitest `src/modules/portal-bid`; web `tsc` and eslint on touched files.

## Docs
`docs/environment-variables.md` (new vars), `docs/deployment.md` (install step, `PLAYWRIGHT_BROWSERS_PATH`, Windows notes, "not supported in Docker deployment"), `CLAUDE.md` gotcha (Docker cannot show the window; CLI scripts use CDP).

## Verification
1. Unit tests and typechecks as above.
2. Manual on Mac: `pnpm dev`; tender page, click "Open portal browser" - Chromium opens at the portal; log in once; open a response; click "Fill portal bid" and watch the bar fill; confirm the window stays open after the fill; restart the server, click Open again and confirm the login persisted.
3. Close the window by hand, click Fill, confirm the clear "open the portal browser" error.
4. Windows: preview-workflow screenshot, then a real run on the user's Windows PC.
