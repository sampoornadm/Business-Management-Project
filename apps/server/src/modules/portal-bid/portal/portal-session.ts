/// <reference lib="dom" />
import { chromium, type Browser, type Frame, type Page } from "playwright-core";

import type { Widget } from "../portal-bid.types.js";

// The only tabs this driver will ever open. Check and Submit live in the portal's toolbar and
// nothing in this file clicks them. The one toolbar button it can press is Save, and only through
// `save()`, which a caller must ask for explicitly.
const TABS = ["Questions", "Items", "Conditions"] as const;
export type PortalTab = (typeof TABS)[number];

export interface PortalHeader {
  responseNumber: string;
  rfxNumber: string;
  deadline: string | null;
  totalValue: string | null;
}

export interface ConditionRow {
  itemCode: string;
  conditions: Record<string, string>;
}

type ConditionItem = { itemCode: string; conditions: Record<string, { id: string; value: string }> };
const hasConditions = (item: ConditionItem | undefined) => Object.keys(item?.conditions ?? {}).length > 0;
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const collapse = (text: string) => text.replace(/[\s\u00a0]+/g, " ").trim();
const KEY_DELAY_MS = 8;
const DOM_QUIET_MS = 150;
const QUIET_CAP_MS = 3000;
const CLICK_TIMEOUT_MS = 5000;
const ATTEMPTS = 3;

/**
 * Drives one SAIL ISP (SAP Web Dynpro) tab in a Chrome the user already logged in to. Control ids
 * (`WD0979`) change every session, so fields are found by label text: each label's `f` attribute
 * names its control. Values are typed with real key events because Web Dynpro only commits a
 * field on the keystroke / blur round trip, never on a scripted `.value =`.
 */
export class PortalSession {
  /**
   * `frame` is the document holding the Web Dynpro app. Under /irj/portal that is an iframe, not
   * the top document, so every lookup and locator goes through it; only keystrokes and load-state
   * waits belong to the page.
   */
  constructor(
    private readonly page: Page,
    private readonly frame: Frame = page.mainFrame(),
  ) {
    // Count only the portal's own action POSTs: it also keeps other connections open for good,
    // which is why waiting for "network idle" always ran into its timeout.
    const isAction = (request: { method(): string; url(): string }) =>
      request.method() === "POST" && request.url().includes("/webdynpro/");
    page.on("request", (request) => {
      if (isAction(request)) this.inFlight += 1;
    });
    const done = (request: { method(): string; url(): string }) => {
      if (isAction(request)) this.inFlight = Math.max(0, this.inFlight - 1);
    };
    page.on("requestfinished", done);
    page.on("requestfailed", done);
  }

  private inFlight = 0;
  private browser: Browser | undefined;

  static async attach(cdpUrl: string): Promise<PortalSession> {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap((context) => context.pages());
    const portalPages = pages.filter((candidate) => /sailisp\.co\.in/.test(candidate.url()));
    if (portalPages.length === 0) {
      await browser.close();
      throw new Error(`No SAIL ISP tab is open in the Chrome at ${cdpUrl}`);
    }
    const session = await PortalSession.findIn(portalPages);
    if (!session) {
      await browser.close();
      throw new Error("None of the SAIL ISP tabs is showing an RFx response; open the response first");
    }
    session.browser = browser;
    return session;
  }

  /** Lets go of the CDP connection; on a connected (not launched) browser this leaves Chrome open. */
  async disconnect(): Promise<void> {
    await this.browser?.close();
  }

  /** The first frame, in any of `pages`, that shows an RFx response header; null if none does. */
  static async findIn(pages: Page[]): Promise<PortalSession | null> {
    for (const page of pages) {
      for (const frame of page.frames()) {
        const session = new PortalSession(page, frame);
        if (await session.isResponsePage().catch(() => false)) return session;
      }
    }
    return null;
  }

  async isResponsePage(): Promise<boolean> {
    return (await this.controlIds("RFx Number")).length > 0;
  }

  async readHeader(): Promise<PortalHeader> {
    const optional = (label: string) => this.readField(label).catch(() => null);
    return {
      responseNumber: await this.readField("Number"),
      rfxNumber: await this.readField("RFx Number"),
      deadline: await optional("Submission Deadline"),
      totalValue: await optional("Total Value"),
    };
  }

  async openTab(name: PortalTab): Promise<void> {
    if (!TABS.includes(name)) throw new Error(`"${name}" is not an allowed tab`);
    // A tab is a Web Dynpro HCNP item whose text includes a hidden "text helper" copy of its own
    // label ("QuestionsQuestions"), so an exact text match misses it and hits the hidden copy.
    const label = new RegExp(`^\\s*${name}\\s*(?:${name})?\\s*$`);
    await this.frame
      .locator('[ct="HCNPI_standards"], [ct="HCNPMI_standards"]')
      .filter({ hasText: label })
      .filter({ visible: true })
      .first()
      .click({ timeout: 10_000 });
    await this.settle();
  }

  async readField(label: string): Promise<string> {
    const id = await this.controlId(label);
    const value = await this.run((controlId) => {
      const el = document.getElementById(controlId);
      if (!el) return null;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
      if (el.getAttribute("ct") === "RG") {
        const checked = Array.from(el.querySelectorAll('[ct="R_standards"]')).find((radio) =>
          /lsRadioButton--checked/.test(radio.className),
        );
        return (checked?.textContent ?? "").trim();
      }
      return (el.textContent ?? "").trim();
    }, id);
    if (value === null) throw new Error(`label not found: ${label}`);
    return value;
  }

  /** The free-text Comment cell on the same row as `label` (empty string when it has none). */
  async readComment(label: string): Promise<string> {
    const id = await this.controlId(label);
    const commentId = await this.commentId(id);
    return commentId ? this.frame.locator(`#${commentId}`).inputValue() : "";
  }

  async writeField(label: string, value: string, widget: Widget, options?: { comment?: string }): Promise<void> {
    if (widget === "radio" && value !== "Yes" && value !== "No") {
      throw new Error(`radio answer must be Yes or No, got "${value}"`);
    }
    await this.withFreshControl(label, async (id) => {
      if (widget === "radio") {
        await this.frame
          .locator(`#${id} [ct="R_standards"]`)
          .filter({ hasText: new RegExp(`^\\s*${value}\\s*$`) })
          .click({ timeout: CLICK_TIMEOUT_MS });
        await this.settle();
        if ((await this.readField(label)) !== value) throw new Error(`radio did not take ${value}: ${label}`);
        return;
      }
      if (widget === "combo") {
        // A combo box is a read-only field with a list behind its arrow: pick the entry, never type.
        await this.frame.locator(`#${id}-btn`).click({ timeout: CLICK_TIMEOUT_MS });
        const entry = this.frame
          .locator('[ct="LIB_I"]')
          .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`) })
          .filter({ visible: true })
          .first();
        const listed = await entry
          .waitFor({ state: "visible", timeout: CLICK_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false);
        if (!listed) {
          await this.page.keyboard.press("Escape");
          throw new Error(`value not offered: ${value}`);
        }
        await entry.click({ timeout: CLICK_TIMEOUT_MS });
        await this.settle();
        if ((await this.readField(label)) !== value) throw new Error(`value not offered: ${value}`);
        return;
      }
      await this.typeInto(id, value);
      // The portal can lose a commit it re-renders over; reading back is how that shows.
      if ((await this.readField(label)) !== value) throw new Error(`field did not keep "${value}": ${label}`);
    });
    if (options?.comment !== undefined) {
      await this.withFreshControl(label, async (id) => {
        const commentId = await this.commentId(id);
        if (!commentId) throw new Error(`no comment cell on the row of: ${label}`);
        await this.typeInto(commentId, options.comment!);
        if ((await this.readComment(label)) !== options.comment) {
          throw new Error(`comment did not keep "${options.comment}": ${label}`);
        }
      });
    }
  }

  /** Presses the toolbar's Save button once (never Check or Submit). Throws unless exactly one exists. */
  async save(): Promise<void> {
    // The toolbar button is a Web Dynpro `ct="B"` titled "Save Document"; Check and Submit have other titles.
    const button = this.frame.locator('[ct="B"][title="Save Document"]');
    const count = await button.count();
    if (count !== 1) throw new Error(`expected one Save button, found ${count}`);
    await button.click({ timeout: CLICK_TIMEOUT_MS });
    await this.settle();
  }

  /** Presses the toolbar's Edit button once (the response opens read-only after a Save). */
  async edit(): Promise<void> {
    const button = this.frame
      .locator('[ct="B"]')
      .filter({ has: this.frame.locator(".lsButton__text", { hasText: /^Edit$/ }) })
      .filter({ visible: true });
    const count = await button.count();
    if (count !== 1) throw new Error(`expected one Edit button, found ${count}`);
    await button.click({ timeout: CLICK_TIMEOUT_MS });
    await this.settle();
  }

  /**
   * Every item on the Conditions grid with its condition amounts. The grid only renders a window of
   * rows (about 100, so ~8 expanded items), so it collapses everything and opens one item at a time.
   */
  async readConditionRows(): Promise<ConditionRow[]> {
    await this.collapseAll();
    const collapsed = await this.pollItems((items) => items.length > 0 && items.every((i) => !hasConditions(i)));
    const rows: ConditionRow[] = [];
    for (const { itemCode } of collapsed) {
      await this.setNode(itemCode, "Expand");
      const items = await this.pollItems((all) => hasConditions(all.find((i) => i.itemCode === itemCode)));
      const item = items.find((i) => i.itemCode === itemCode);
      rows.push({
        itemCode,
        conditions: Object.fromEntries(Object.entries(item?.conditions ?? {}).map(([type, cell]) => [type, cell.value])),
      });
      await this.setNode(itemCode, "Collapse");
      await this.pollItems((all) => !hasConditions(all.find((i) => i.itemCode === itemCode)));
    }
    return rows;
  }

  async writeCondition(itemCode: string, conditionType: string, amount: string): Promise<void> {
    const hasCell = (items: ConditionItem[]) => Boolean(items.find((i) => i.itemCode === itemCode)?.conditions[conditionType]);
    // A previous edit may still be re-rendering the grid; give it a moment before moving anything.
    let items = await this.pollItems(hasCell, 1500);
    // The grid renders a window of rows and re-expands every node after each edit, so when the cell
    // is not in view, collapse all and open just this item.
    if (!hasCell(items)) {
      await this.collapseAll();
      await this.pollItems((all) => all.length > 0 && all.every((i) => !hasConditions(i)));
      await this.setNode(itemCode, "Expand");
      items = await this.pollItems(hasCell);
    }
    const item = items.find((row) => row.itemCode === itemCode);
    if (!item) throw new Error(`item not found: ${itemCode}`);
    const cell = item.conditions[conditionType];
    if (!cell) throw new Error(`condition not found: ${conditionType}`);
    await this.typeInto(cell.id, amount);
  }

  /** Re-reads the grid until `done` holds or the timeout passes; returns the last reading. */
  private async pollItems(done: (items: ConditionItem[]) => boolean, timeoutMs = 5000): Promise<ConditionItem[]> {
    const deadline = Date.now() + timeoutMs;
    let items = await this.conditionIndex();
    while (!done(items) && Date.now() < deadline) {
      await this.page.waitForTimeout(120);
      items = await this.conditionIndex();
    }
    return items;
  }

  private async collapseAll(): Promise<void> {
    const link = this.frame.locator('a[ct="LN"]').filter({ hasText: /^\s*Collapse All\s*$/ }).filter({ visible: true });
    if ((await link.count()) === 0) throw new Error("Collapse All link not found on the Conditions grid");
    await link.first().click({ timeout: CLICK_TIMEOUT_MS });
    await this.settle();
  }

  /** Opens or closes an item's node; a no-op when the node is already in that state or absent. */
  private async setNode(itemCode: string, state: "Expand" | "Collapse"): Promise<void> {
    const toggle = this.frame
      .locator('td[cc="1"]')
      .filter({
        has: this.frame.locator('[ct="TV"]', {
          hasText: new RegExp(`^\\s*Item\\s+\\d+\\s*-\\s*${escapeRegExp(itemCode)}\\b`),
        }),
      })
      .locator(`[title="${state} Node"]`);
    if ((await toggle.count()) === 0) return;
    await toggle.first().click({ timeout: CLICK_TIMEOUT_MS });
    await this.settle();
  }

  /** Read-only: which of `labels` are absent from the page, and which match more than one control. */
  async checkLabels(labels: string[]): Promise<{ missing: string[]; ambiguous: string[] }> {
    const missing: string[] = [];
    const ambiguous: string[] = [];
    for (const label of labels) {
      const ids = await this.controlIds(label);
      if (ids.length === 0) missing.push(label);
      else if (ids.length > 1) ambiguous.push(label);
    }
    return { missing, ambiguous };
  }

  private controlIds(label: string): Promise<string[]> {
    return this.run((wanted) => {
      const normalise = (text: string) => text.replace(/[\s\u00a0]+/g, " ").trim();
      return Array.from(document.querySelectorAll('label[ct="L"]'))
        .filter((el) => normalise(el.textContent ?? "") === wanted)
        .map((el) => el.getAttribute("f"))
        .filter((id): id is string => Boolean(id));
    }, collapse(label));
  }

  // A generic label ("Address", "Email") can occur twice on a page; typing into the first match
  // would leave the real question empty while the read-back (same lookup) still agrees.
  private async controlId(label: string): Promise<string> {
    const ids = await this.controlIds(label);
    if (ids.length === 0) throw new Error(`label not found: ${label}`);
    if (ids.length > 1) throw new Error(`label ambiguous: ${label}`);
    return ids[0]!;
  }

  private commentId(controlId: string): Promise<string | null> {
    return this.run((id) => {
      const row = document.getElementById(id)?.closest("tr");
      // Comment cells are plain (ct="I") or suggest (ct="CBS") inputs; any text input but the reply.
      const inputs = Array.from(row?.querySelectorAll("input, textarea") ?? []).filter((input) => input.id !== id);
      return inputs.length > 0 ? inputs[inputs.length - 1]!.id : null;
    }, controlId);
  }

  private conditionIndex(): Promise<ConditionItem[]> {
    return this.run(() => {
      type Group = { itemCode: string; conditions: Record<string, { id: string; value: string }> };
      const groups: Group[] = [];
      let current: Group | null = null;
      // Only real grid rows: the tree's hierarchy cells hold nested tables with their own <tr>s.
      const rows = Array.from(document.querySelectorAll("tr")).filter((tr) => tr.querySelector(":scope > td[cc]"));
      for (const tr of rows) {
        const node = tr.querySelector('td[cc="1"] span[ct="TV"]')?.textContent ?? "";
        if (node) {
          const match = /^Item\s+\d+\s*-\s*(\S+)/.exec(node.trim());
          current = match ? { itemCode: match[1]!, conditions: {} } : null;
          if (current) groups.push(current);
          continue;
        }
        if (!current) continue;
        const amount = tr.querySelector(':scope > td[cc="3"] input') as HTMLInputElement | null;
        const cells = Array.from(tr.children).filter((cell) => cell.hasAttribute("cc"));
        const type = cells[cells.length - 1]?.querySelector("input") as HTMLInputElement | null;
        if (amount && type?.value) current.conditions[type.value] = { id: amount.id, value: amount.value };
      }
      return groups;
    });
  }

  private async typeInto(id: string, value: string): Promise<void> {
    await this.frame.locator(`#${id}`).click({ timeout: CLICK_TIMEOUT_MS });
    await this.page.keyboard.press("ControlOrMeta+A");
    await this.page.keyboard.type(value, { delay: KEY_DELAY_MS });
    await this.page.keyboard.press("Tab");
    await this.settle();
  }

  // Each keystroke and each commit is a server round trip; wait for the page to go quiet. A
  // portal that never idles must not hang the run, so a timeout is not an error here.
  // The portal re-renders after each round trip and hands out new control ids, so an id resolved
  // a moment ago can be gone by the time it is used. Resolve fresh, act, and retry on failure.
  private async withFreshControl<T>(label: string, action: (id: string) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      try {
        await this.quiet();
        return await action(await this.controlId(label));
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "";
        if (message.startsWith("label not found") || message.startsWith("label ambiguous")) throw error;
      }
    }
    throw lastError;
  }

  /** Resolves once no portal action is in flight and the DOM has been still for a moment (3 s cap). */
  private async quiet(): Promise<void> {
    const deadline = Date.now() + QUIET_CAP_MS;
    while (Date.now() < deadline) {
      if (this.inFlight > 0) {
        await this.page.waitForTimeout(40);
        continue;
      }
      await this.frame.evaluate(`new Promise((resolve) => {
        let timer;
        const done = () => { observer.disconnect(); resolve(true); };
        const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, ${DOM_QUIET_MS}); });
        observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
        timer = setTimeout(done, ${DOM_QUIET_MS});
        setTimeout(done, 1000);
      })`);
      // A request can start while the DOM settles; only a calm moment on both counts is done.
      if (this.inFlight === 0) return;
    }
  }

  // In-page code is compiled by tsx/esbuild, which wraps named functions in a `__name()` helper
  // that does not exist inside the portal's page; without this shim every lookup throws there.
  private async run<R, A = undefined>(fn: (arg: A) => R, arg?: A): Promise<Awaited<R>> {
    await this.frame.evaluate("globalThis.__name = globalThis.__name || ((target) => target)");
    return this.frame.evaluate(fn as never, arg as never) as Promise<Awaited<R>>;
  }

  private async settle(): Promise<void> {
    await this.quiet();
  }
}
