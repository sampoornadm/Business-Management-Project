/// <reference lib="dom" />
import { chromium, type Page } from "playwright-core";

import type { Widget } from "../portal-bid.types.js";

// The only tabs this driver will ever open. Save, Check and Submit live in the portal's toolbar,
// not here, and nothing in this file clicks them: the user reviews and saves.
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

const collapse = (text: string) => text.replace(/[\s ]+/g, " ").trim();
const KEY_DELAY_MS = 30;

/**
 * Drives one SAIL ISP (SAP Web Dynpro) tab in a Chrome the user already logged in to. Control ids
 * (`WD0979`) change every session, so fields are found by label text: each label's `f` attribute
 * names its control. Values are typed with real key events because Web Dynpro only commits a
 * field on the keystroke / blur round trip, never on a scripted `.value =`.
 */
export class PortalSession {
  constructor(private readonly page: Page) {}

  static async attach(cdpUrl: string): Promise<PortalSession> {
    const browser = await chromium.connectOverCDP(cdpUrl);
    const pages = browser.contexts().flatMap((context) => context.pages());
    const page = pages.find((candidate) => /sailisp\.co\.in/.test(candidate.url()));
    if (!page) throw new Error(`No SAIL ISP tab is open in the Chrome at ${cdpUrl}`);
    return new PortalSession(page);
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
    await this.page.getByText(name, { exact: true }).first().click();
    await this.settle();
  }

  async readField(label: string): Promise<string> {
    const id = await this.controlId(label);
    const value = await this.page.evaluate((controlId) => {
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
    return commentId ? this.page.locator(`#${commentId}`).inputValue() : "";
  }

  async writeField(label: string, value: string, widget: Widget, options?: { comment?: string }): Promise<void> {
    const id = await this.controlId(label);
    if (widget === "radio") {
      if (value !== "Yes" && value !== "No") throw new Error(`radio answer must be Yes or No, got "${value}"`);
      await this.page
        .locator(`#${id} [ct="R_standards"]`)
        .filter({ hasText: new RegExp(`^\\s*${value}\\s*$`) })
        .click();
      await this.settle();
    } else {
      await this.typeInto(id, value);
      // A combo box silently drops text it does not offer; reading back is how that shows.
      if (widget === "combo" && (await this.readField(label)) !== value) {
        throw new Error(`value not offered: ${value}`);
      }
    }
    if (options?.comment !== undefined) {
      const commentId = await this.commentId(id);
      if (!commentId) throw new Error(`no comment cell on the row of: ${label}`);
      await this.typeInto(commentId, options.comment);
    }
  }

  async readConditionRows(): Promise<ConditionRow[]> {
    const index = await this.conditionIndex();
    return index.map(({ itemCode, conditions }) => ({
      itemCode,
      conditions: Object.fromEntries(Object.entries(conditions).map(([type, cell]) => [type, cell.value])),
    }));
  }

  async writeCondition(itemCode: string, conditionType: string, amount: string): Promise<void> {
    const item = (await this.conditionIndex()).find((row) => row.itemCode === itemCode);
    if (!item) throw new Error(`item not found: ${itemCode}`);
    const cell = item.conditions[conditionType];
    if (!cell) throw new Error(`condition not found: ${conditionType}`);
    await this.typeInto(cell.id, amount);
  }

  private async controlId(label: string): Promise<string> {
    const id = await this.page.evaluate((wanted) => {
      const normalise = (text: string) => text.replace(/[\s ]+/g, " ").trim();
      for (const el of Array.from(document.querySelectorAll('label[ct="L"]'))) {
        if (normalise(el.textContent ?? "") === wanted) return el.getAttribute("f");
      }
      return null;
    }, collapse(label));
    if (!id) throw new Error(`label not found: ${label}`);
    return id;
  }

  private commentId(controlId: string): Promise<string | null> {
    return this.page.evaluate((id) => {
      const row = document.getElementById(id)?.closest("tr");
      const inputs = Array.from(row?.querySelectorAll('input[ct="I"]') ?? []).filter((input) => input.id !== id);
      return inputs.length > 0 ? inputs[inputs.length - 1]!.id : null;
    }, controlId);
  }

  private conditionIndex(): Promise<Array<{ itemCode: string; conditions: Record<string, { id: string; value: string }> }>> {
    return this.page.evaluate(() => {
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
    await this.page.locator(`#${id}`).click();
    await this.page.keyboard.press("ControlOrMeta+A");
    await this.page.keyboard.type(value, { delay: KEY_DELAY_MS });
    await this.page.keyboard.press("Tab");
    await this.settle();
  }

  // Each keystroke and each commit is a server round trip; wait for the page to go quiet. A
  // portal that never idles must not hang the run, so a timeout is not an error here.
  private async settle(): Promise<void> {
    await this.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
  }
}
