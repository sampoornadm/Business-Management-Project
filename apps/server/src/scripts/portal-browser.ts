/* eslint-disable no-console -- command-line tool: console is its output */
import { env } from "../config/env.js";
import { defaultProfileDir, PortalBrowser } from "../modules/portal-bid/portal/portal-browser.js";

// Opens the same window the "Open portal browser" button does, so its look and feel (and the
// Chromium install) can be checked on a machine without starting the whole app.
const browser = new PortalBrowser({
  profileDir: env.PORTAL_BROWSER_DIR ?? defaultProfileDir(),
  portalUrl: env.PORTAL_URL,
  executablePath: env.PORTAL_BROWSER_PATH,
});

browser
  .open()
  .then(async () => {
    console.log("Portal browser open. Close its window to exit.");
    await browser.closed();
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    console.error("If Chromium is missing, run: pnpm portal:browser:install");
    process.exit(1);
  });
