import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium, type BrowserContext } from "playwright-core";
import { afterEach, describe, expect, it } from "vitest";

import { defaultProfileDir, PortalBrowser, portalLaunchOptions } from "../portal/portal-browser.js";

const here = dirname(fileURLToPath(import.meta.url));

class FakePage {
  gotos: string[] = [];
  fronted = 0;
  constructor(private currentUrl = "about:blank") {}
  url() {
    return this.currentUrl;
  }
  async goto(url: string) {
    this.gotos.push(url);
    this.currentUrl = url;
  }
  async bringToFront() {
    this.fronted += 1;
  }
  frames() {
    return [];
  }
}

class FakeContext {
  pageList: FakePage[] = [new FakePage()];
  closeHandlers: Array<() => void> = [];
  pages() {
    return this.pageList;
  }
  async newPage() {
    const page = new FakePage();
    this.pageList.push(page);
    return page;
  }
  on(event: string, handler: () => void) {
    if (event === "close") this.closeHandlers.push(handler);
  }
  async close() {
    for (const handler of this.closeHandlers) handler();
  }
}

describe("PortalBrowser with a fake browser", () => {
  const config = { profileDir: "/profile", portalUrl: "https://srm.sailisp.co.in" };

  function setup() {
    const launches: Array<{ dir: string; options: Record<string, unknown> }> = [];
    const contexts: FakeContext[] = [];
    const browser = new PortalBrowser(config, async (dir, options) => {
      launches.push({ dir, options: options as Record<string, unknown> });
      const context = new FakeContext();
      contexts.push(context);
      return context as unknown as BrowserContext;
    });
    return { browser, launches, contexts };
  }

  it("launches a visible window on the portal with the profile folder", async () => {
    const { browser, launches, contexts } = setup();
    await browser.open();
    expect(launches).toHaveLength(1);
    expect(launches[0]!.dir).toBe("/profile");
    expect(launches[0]!.options).toMatchObject({ headless: false, viewport: null, ignoreDefaultArgs: ["--enable-automation"] });
    expect(contexts[0]!.pageList[0]!.gotos).toEqual([config.portalUrl]);
  });

  it("brings the open window forward instead of launching a second one, even for simultaneous clicks", async () => {
    const { browser, launches, contexts } = setup();
    await Promise.all([browser.open(), browser.open()]);
    await browser.open();
    expect(launches).toHaveLength(1);
    expect(contexts[0]!.pageList[0]!.fronted).toBe(3);
    expect(contexts[0]!.pageList[0]!.gotos).toHaveLength(1);
  });

  it("reports closed, and launches afresh, once the user closes the window", async () => {
    const { browser, launches, contexts } = setup();
    await browser.open();
    expect(await browser.status()).toEqual({ open: true, onResponsePage: false });
    await contexts[0]!.close();
    expect(await browser.status()).toEqual({ open: false, onResponsePage: false });
    expect(await browser.session()).toBeNull();
    await browser.open();
    expect(launches).toHaveLength(2);
  });

  it("can launch again after a failed launch", async () => {
    let attempts = 0;
    const browser = new PortalBrowser(config, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Executable doesn't exist");
      return new FakeContext() as unknown as BrowserContext;
    });
    await expect(browser.open()).rejects.toThrow("Executable doesn't exist");
    await expect(browser.open()).resolves.toBeUndefined();
  });

  it("passes a custom browser binary through, and omits it otherwise", () => {
    expect(portalLaunchOptions("C:\\Program Files\\Edge\\msedge.exe").executablePath).toBe("C:\\Program Files\\Edge\\msedge.exe");
    expect("executablePath" in portalLaunchOptions()).toBe(false);
  });

  it("keeps the profile in the user's home folder", () => {
    expect(defaultProfileDir()).toMatch(/\.bmp-portal-browser$/);
  });
});

describe("PortalBrowser with real Chromium", () => {
  let profileDir: string | undefined;
  let browser: PortalBrowser | undefined;

  afterEach(async () => {
    await browser?.close();
    if (profileDir) rmSync(profileDir, { recursive: true, force: true });
  });

  it("opens on a bid response, reports it, and survives a fill ending (disconnect)", async () => {
    profileDir = mkdtempSync(join(tmpdir(), "bmp-portal-"));
    const url = pathToFileURL(join(here, "fixtures", "questions-page.html")).href;
    // Headless only so the test needs no display; the options under test are otherwise the real ones.
    browser = new PortalBrowser({ profileDir, portalUrl: url }, (dir, options) =>
      chromium.launchPersistentContext(dir, { ...options, headless: true }),
    );
    await browser.open();
    const first = await browser.status();
    expect(first).toMatchObject({ open: true, onResponsePage: true });
    expect(first.responseNumber).toBeTruthy();

    // A session handed to a fill is disconnected when the fill ends; that must not close the window.
    const session = await browser.session();
    await session!.disconnect();
    expect(await browser.status()).toMatchObject({ open: true, onResponsePage: true });
  }, 60_000);
});
