import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PortalSession } from "../portal/portal-session.js";

const dir = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => readFileSync(join(dir, "fixtures", name), "utf8");

let browser: Browser;
let page: Page;

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => {
  await browser.close();
});

describe("PortalSession on the Questions page", () => {
  let session: PortalSession;

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent(fixture("questions-page.html"));
    session = new PortalSession(page);
  });

  it("reads the header, including the response number", async () => {
    expect(await session.readHeader()).toEqual({
      responseNumber: "8100095724",
      rfxNumber: "1400014359",
      deadline: "27.10.2026 15:00:00 INDIA",
      totalValue: "14,200.00 INR",
    });
  });

  it("recognises a response page by its RFx header", async () => {
    expect(await session.isResponsePage()).toBe(true);
    await page.setContent("<p>portal home</p>");
    expect(await session.isResponsePage()).toBe(false);
  });

  it("defines tsx's __name helper in the page before running in-page code", async () => {
    // tsx/esbuild wraps named functions in __name(); evaluated in the page it is undefined.
    expect(await page.evaluate(() => typeof (globalThis as { __name?: unknown }).__name)).toBe("undefined");
    await session.readField("Enter GSTIN/ ARN");
    expect(await page.evaluate(() => typeof (globalThis as { __name?: unknown }).__name)).toBe("function");
  });

  it("reads a field by its label text", async () => {
    expect(await session.readField("Enter GSTIN/ ARN")).toBe("19AAAAA0000A1Z5");
  });

  it("throws a clear error for a label that is not on the page", async () => {
    await expect(session.readField("Nope")).rejects.toThrow("label not found: Nope");
  });

  it("writes a text field and reads it back", async () => {
    await session.writeField("Enter GSTIN/ ARN", "19ZZZZZ9999Z9Z9", "text");
    expect(await session.readField("Enter GSTIN/ ARN")).toBe("19ZZZZZ9999Z9Z9");
  });

  it("matches a label that contains a non-breaking space", async () => {
    await session.writeField("Techno commercial offer validity from date of tender opening", "Yes", "radio");
    expect(await session.readField("Techno commercial offer validity from date of tender opening")).toBe("Yes");
  });

  it("switches a radio group and reads the checked option", async () => {
    const label = "Are you registered for GSTIN ? (N.B: Vendors who are not registered are case of Reverse Charge and ISP has to pay GST to GOVT.)";
    expect(await session.readField(label)).toBe("Yes");
    await session.writeField(label, "No", "radio");
    expect(await session.readField(label)).toBe("No");
  });

  it("writes and reads the Comment cell of a row", async () => {
    const label = "Techno commercial offer validity from date of tender opening";
    await session.writeField(label, "Yes", "radio", { comment: "20 days" });
    expect(await session.readComment(label)).toBe("20 days");
  });

  it("accepts an offered combo-box value", async () => {
    await session.writeField("Dispatch Mode", "RAIL", "combo");
    expect(await session.readField("Dispatch Mode")).toBe("RAIL");
  });

  it("fails when a combo-box does not offer the value", async () => {
    await expect(session.writeField("Dispatch Mode", "AIR", "combo")).rejects.toThrow("value not offered: AIR");
  });

  it("refuses a label that matches more than one control", async () => {
    await page.setContent(`
      <label ct="L" f="A1"><span>Address</span></label><input id="A1" ct="I">
      <label ct="L" f="A2"><span>Address</span></label><input id="A2" ct="I">`);
    await expect(session.writeField("Address", "x", "text")).rejects.toThrow("label ambiguous: Address");
    await expect(session.readField("Address")).rejects.toThrow("label ambiguous: Address");
  });

  it("reports missing and ambiguous labels without touching the page", async () => {
    await page.setContent(`
      <label ct="L" f="A1"><span>Address</span></label><input id="A1" ct="I" value="keep">
      <label ct="L" f="A2"><span>Address</span></label><input id="A2" ct="I">
      <label ct="L" f="B1"><span>Email</span></label><input id="B1" ct="I">`);
    expect(await session.checkLabels(["Email", "Address", "Nope"])).toEqual({
      missing: ["Nope"],
      ambiguous: ["Address"],
    });
    expect(await page.locator("#A1").inputValue()).toBe("keep");
  });

  it("clicks the toolbar Save button and nothing else", async () => {
    await session.save();
    expect(await page.locator("#shown").textContent()).toBe("SAVED");
  });

  it("clicks the toolbar Edit button and nothing else", async () => {
    await session.edit();
    expect(await page.locator("#shown").textContent()).toBe("EDIT");
  });

  it("refuses to edit when there is no single visible Edit button", async () => {
    await page.evaluate(() => document.getElementById("tb-edit")!.remove());
    await expect(session.edit()).rejects.toThrow("expected one Edit button, found 0");
  });

  it("refuses to save when it cannot find exactly one Save button", async () => {
    await page.evaluate(() => document.getElementById("tb-save")!.remove());
    await expect(session.save()).rejects.toThrow("expected one Save button");
    expect(await page.locator("#shown").textContent()).not.toBe("SUBMITTED");
  });

  it("opens an allowed tab and refuses anything else", async () => {
    await session.openTab("Items");
    expect(await page.locator("#shown").textContent()).toBe("Items");
    await expect(session.openTab("Save" as never)).rejects.toThrow("not an allowed tab");
    expect(await page.locator("#shown").textContent()).toBe("Items");
  });
});

describe("PortalSession speed", () => {
  it("does not wait for a connection the portal keeps open forever", async () => {
    page = await browser.newPage();
    await page.route("http://portal.test/page", (route) =>
      route.fulfill({ contentType: "text/html", body: `${fixture("questions-page.html")}<script>fetch("/poll")</script>` }),
    );
    await page.route("http://portal.test/poll", () => undefined); // never answered
    await page.goto("http://portal.test/page", { waitUntil: "domcontentloaded" });
    const session = new PortalSession(page);
    const started = Date.now();
    await session.writeField("Enter GSTIN/ ARN", "19ZZZZZ9999Z9Z9", "text");
    await session.writeField("Dispatch Mode", "RAIL", "combo");
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("PortalSession when the portal re-renders under it", () => {
  let session: PortalSession;

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent(fixture("flaky-page.html"));
    session = new PortalSession(page);
  });

  it("retries a text field whose first commit was lost", async () => {
    await session.writeField("Place of Dispatch", "Kolkata", "text");
    expect(await session.readField("Place of Dispatch")).toBe("Kolkata");
  });

  it("re-resolves a radio group whose ids changed after the click", async () => {
    await session.writeField("Are you registered for GSTIN ?", "Yes", "radio");
    expect(await session.readField("Are you registered for GSTIN ?")).toBe("Yes");
  });

  it("gives up with a clear error when a value never sticks", async () => {
    await page.evaluate(() => {
      document.querySelector("input")!.addEventListener("blur", (e) => ((e.target as HTMLInputElement).value = ""));
    });
    await expect(session.writeField("Place of Dispatch", "Kolkata", "text")).rejects.toThrow(/did not keep/);
  });
});

describe("PortalSession inside the portal's iframe", () => {
  // The real portal wraps the Web Dynpro app in an iframe under /irj/portal.
  const wrap = (inner: string) =>
    `<p>portal chrome</p><iframe id="wd" srcdoc="${inner.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"></iframe>`;

  it("finds the frame that shows an RFx response and drives it", async () => {
    page = await browser.newPage();
    await page.setContent(wrap(fixture("questions-page.html")));
    await (await (await page.locator("#wd").elementHandle())!.contentFrame())!.waitForLoadState();
    const found = await PortalSession.findIn([page]);
    expect(found).not.toBeNull();
    expect((await found!.readHeader()).responseNumber).toBe("8100095724");
    await found!.writeField("Enter GSTIN/ ARN", "19ZZZZZ9999Z9Z9", "text");
    expect(await found!.readField("Enter GSTIN/ ARN")).toBe("19ZZZZZ9999Z9Z9");
  });

  it("returns null when no tab shows an RFx response", async () => {
    page = await browser.newPage();
    await page.setContent("<p>portal home</p>");
    expect(await PortalSession.findIn([page])).toBeNull();
  });
});

describe("PortalSession on the Conditions grid", () => {
  let session: PortalSession;

  beforeEach(async () => {
    page = await browser.newPage();
    await page.setContent(fixture("conditions-grid.html"));
    session = new PortalSession(page);
  });

  it("reads every item even when the grid only renders a window of rows", async () => {
    const rows = await session.readConditionRows();
    expect(rows.map((r) => r.itemCode)).toEqual(["71802001600160", "5550001", "6660002"]);
    expect(rows[0]!.conditions).toEqual({
      Price: "17.75",
      "CGST (Ded-ITC) %": "9.00",
      "SGST (Ded-ITC) %": "9.00",
      "IGST (Ded-ITC) %": "0.00",
    });
    expect(Object.keys(rows[2]!.conditions)).toHaveLength(4);
  });

  it("writes a condition amount for an item outside the initial window", async () => {
    await session.writeCondition("6660002", "Price", "12.5");
    const rows = await session.readConditionRows();
    expect(rows[2]!.conditions.Price).toBe("12.5");
    expect(rows[0]!.conditions.Price).toBe("17.75");
    expect(rows[1]!.conditions.Price).toBe("0.00");
  });

  it("writes several conditions of one item in a row", async () => {
    await session.writeCondition("5550001", "Price", "3");
    await session.writeCondition("5550001", "CGST (Ded-ITC) %", "9");
    await session.writeCondition("6660002", "Price", "4");
    const rows = await session.readConditionRows();
    expect(rows[1]!.conditions).toMatchObject({ Price: "3", "CGST (Ded-ITC) %": "9" });
    expect(rows[2]!.conditions.Price).toBe("4");
  });

  it("fails when the item or condition is not on the grid", async () => {
    await expect(session.writeCondition("9999", "Price", "1")).rejects.toThrow("item not found: 9999");
    await expect(session.writeCondition("5550001", "Freight Charge %", "1")).rejects.toThrow(
      "condition not found: Freight Charge %",
    );
  });
});
