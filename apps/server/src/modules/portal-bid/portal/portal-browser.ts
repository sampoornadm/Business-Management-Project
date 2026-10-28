import os from "node:os";
import path from "node:path";

import type { PortalBrowserStatusDto } from "@bmp/types";
import { chromium, type BrowserContext } from "playwright-core";

import { PortalSession } from "./portal-session.js";

type LaunchOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;
export type ContextLauncher = (profileDir: string, options: LaunchOptions) => Promise<BrowserContext>;

export interface PortalBrowserConfig {
  profileDir: string;
  portalUrl: string;
  /** Run this binary instead of Playwright's own Chromium (e.g. Edge where the download is blocked). */
  executablePath?: string | undefined;
}

/** Where the portal login lives; `os.homedir()` rather than `$HOME` so Windows resolves it too. */
export const defaultProfileDir = () => path.join(os.homedir(), ".bmp-portal-browser");

/**
 * A normal, visible Chromium window. It is launched by this process and talks to it over a pipe, so
 * no debugging port is ever opened. `--enable-automation` is dropped so the window has no
 * "controlled by automated test software" bar and looks like any other browser the user opens.
 */
export function portalLaunchOptions(executablePath?: string): LaunchOptions {
  return {
    headless: false,
    // No emulated viewport: the page follows the real window size, which the user can resize.
    viewport: null,
    args: ["--start-maximized", "--no-first-run", "--no-default-browser-check"],
    ignoreDefaultArgs: ["--enable-automation"],
    ...(executablePath ? { executablePath } : {}),
  };
}

const PORTAL_HOST = /sailisp\.co\.in/;

/**
 * Owns the one browser window the app fills bids in. The user logs into the portal in it once; the
 * profile folder keeps that login across restarts. Closing the window just makes the next
 * `open()` start a fresh one.
 */
export class PortalBrowser {
  private context: BrowserContext | undefined;
  private launching: Promise<BrowserContext> | undefined;

  constructor(
    private readonly config: PortalBrowserConfig,
    private readonly launcher: ContextLauncher = (dir, options) => chromium.launchPersistentContext(dir, options),
  ) {}

  /** Opens the window, or brings the one already open to the front. */
  async open(): Promise<void> {
    // Two quick clicks share one launch instead of fighting over the profile folder.
    const context = this.context ?? (await (this.launching ??= this.launch()));
    const pages = context.pages();
    const page = pages.find((candidate) => PORTAL_HOST.test(candidate.url())) ?? pages[0] ?? (await context.newPage());
    if (page.url() === "about:blank") await page.goto(this.config.portalUrl).catch(() => undefined);
    await page.bringToFront();
  }

  /** The bid response the user has open in the window, or null if the window or the response is not there. */
  async session(): Promise<PortalSession | null> {
    if (!this.context) return null;
    return PortalSession.findIn(this.context.pages());
  }

  async status(): Promise<PortalBrowserStatusDto> {
    if (!this.context) return { open: false, onResponsePage: false };
    const session = await this.session();
    if (!session) return { open: true, onResponsePage: false };
    try {
      const header = await session.readHeader();
      return { open: true, onResponsePage: true, rfxNumber: header.rfxNumber, responseNumber: header.responseNumber };
    } catch {
      return { open: true, onResponsePage: false };
    } finally {
      await session.disconnect();
    }
  }

  /** Resolves when the window is closed (at once if it is not open). */
  closed(): Promise<void> {
    const context = this.context;
    return context ? new Promise((resolve) => context.on("close", () => resolve())) : Promise.resolve();
  }

  /** Closes the window; used when the server shuts down. */
  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
  }

  private async launch(): Promise<BrowserContext> {
    try {
      const context = await this.launcher(this.config.profileDir, portalLaunchOptions(this.config.executablePath));
      context.on("close", () => {
        if (this.context === context) this.context = undefined;
      });
      this.context = context;
      return context;
    } finally {
      this.launching = undefined;
    }
  }
}
