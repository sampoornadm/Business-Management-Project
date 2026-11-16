/// <reference lib="dom" />
import type { Page } from "playwright-core";

/** The portal is showing its logon form; only the user may log in. */
export class PortalLoginRequiredError extends Error {
  constructor() {
    super("Log in to the portal in the browser window, then fetch the comparative statement again");
  }
}

/** No complete comparative statement could be read (not published, still loading, or cut short). */
export class StatementNotAvailableError extends Error {}

export interface GridSnapshot {
  /** `[row, column, text]` for every grid cell currently in the page. */
  cells: [number, number, string][];
  /** What the grid itself says its full size is. */
  totalRows: number;
  totalColumns: number;
  /** Changes whenever the grid is scrolled; tells "still moving" from "at the end". */
  position?: string;
}

export type ScrollMove = "down" | "up" | "right";
type PortalFrame = ReturnType<Page["frames"]>[number];

export interface ReadGridOptions {
  timeoutMs?: number;
  pollMs?: number;
  settleMs?: number;
  /** How long to wait after a scroll for the grid to move or fetch its next rows from SAP. */
  loadWaitMs?: number;
  maxScrolls?: number;
  scroll?: (page: Page, frame: PortalFrame, move: ScrollMove, viaButton: boolean) => Promise<void>;
  /** One line per step of the read, for the log the user follows. */
  onProgress?: (line: string) => void;
}

// The two functions below run inside the portal page (Playwright serialises them), so they
// may only use the DOM and their own locals. They must not declare a *named* inner function
// (`const f = () => ...`, `function f() {}`): the server runs under tsx, whose bundler wraps
// those in a `__name(...)` helper that does not exist in the page, and the read then throws
// there. Inline anonymous callbacks are fine. A test checks this.

/**
 * The comparative statement is an SAP WebGUI ALV grid. Every cell is a
 * `<td id="grid#C102#<row>,<column>" lsmatrixrowindex lsmatrixcolindex>`, and the grid's own
 * metadata carries `totalRows` / `totalColumns`, which is how a partly loaded grid is told apart
 * from a complete one. The id carries SAP's own 1-based row and column, so it is preferred over
 * the matrix attributes, which may count from the start of a lazily loaded fragment.
 */
export function readGridInPage(): GridSnapshot | null {
  const tds = Array.from(document.querySelectorAll("td[lsmatrixrowindex][lsmatrixcolindex]"));
  if (tds.length === 0) return null;
  const cells = tds.map((td): [number, number, string] => {
    const id = /#(\d+),(\d+)$/.exec(td.id);
    return [
      id ? Number(id[1]) - 1 : Number(td.getAttribute("lsmatrixrowindex")),
      id ? Number(id[2]) - 1 : Number(td.getAttribute("lsmatrixcolindex")),
      (td.textContent ?? "").replace(/[\s\u00a0]+/g, " ").trim(),
    ];
  });
  // Rows scrolled out of view are `display:none`; sideways the content block is shifted by style.
  const position = [
    String(tds.findIndex((td) => (td as HTMLElement).offsetParent !== null)),
    ...Array.from(document.querySelectorAll("[bisposelement]")).map((element) => element.getAttribute("style") ?? ""),
  ].join("|");
  const meta =
    Array.from(document.querySelectorAll('[lsdata*="totalRows"]'))
      .map((element) => element.getAttribute("lsdata") ?? "")
      .concat(document.documentElement.innerHTML)
      .find((text) => /totalRows\D{1,8}\d+/.test(text)) ?? "";
  // No named helper here on purpose: see the note above these three functions.
  const rows = /totalRows\D{1,8}(\d+)/.exec(meta);
  const columns = /totalColumns\D{1,8}(\d+)/.exec(meta);
  return { cells, totalRows: rows ? Number(rows[1]) : 0, totalColumns: columns ? Number(columns[1]) : 0, position };
}

export function hasLoginFormInPage(): boolean {
  return document.querySelector('form#certLogonForm, form[name="logonForm"], input[type="password"]') !== null;
}

const SCROLL_BUTTON: Record<ScrollMove, string> = { down: "vscroll-Nxt", up: "vscroll-Prev", right: "hscroll-Nxt" };

/**
 * Scrolls the grid the way a person does. It has its own scrollbar (`scrollTop` does nothing), and
 * only fetches rows past its first ~4000 cells from SAP when it is really scrolled, so this sends
 * real mouse-wheel input over the bidder columns, or presses the scrollbar's arrow button.
 */
async function scrollGrid(page: Page, frame: PortalFrame, move: ScrollMove, viaButton: boolean): Promise<void> {
  if (viaButton) {
    const button = frame.locator(`[id$="_${SCROLL_BUTTON[move]}"]`).first();
    await button.click({ timeout: 2_000 }).catch(() => undefined);
    return;
  }
  const box = await frame.locator('[id$="-mrss-cont-none"]').first().boundingBox().catch(() => null);
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // One notch of a mouse wheel and no more: the grid only fetches the rows it comes to rest on, so
  // a jump longer than a screenful leaves a hole (seen live: rows 166-206 of 351 never loaded).
  const [dx, dy] = move === "right" ? [120, 0] : [0, move === "down" ? 120 : -120];
  await page.mouse.wheel(dx, dy);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs an in-page probe. A frame that is mid-navigation or gone is simply "nothing there yet";
 * any other failure is a real fault and must surface, not pass for "statement not published".
 */
async function probe<T>(frame: PortalFrame, fn: () => T): Promise<T | null> {
  try {
    return (await frame.evaluate(fn)) as T;
  } catch (error) {
    if (/detached|destroyed|navigat|closed/i.test(String(error))) return null;
    throw error;
  }
}

/**
 * Waits for the statement grid in any frame of `page` and returns it as a dense matrix
 * (`matrix[row][column]`, `""` for an empty cell). Never returns a partial grid.
 */
export async function readComparativeGrid(page: Page, options: ReadGridOptions = {}): Promise<string[][]> {
  const { timeoutMs = 30_000, pollMs = 500, settleMs = 250, loadWaitMs = 3_000, maxScrolls = 500 } = options;
  const scroll = options.scroll ?? scrollGrid;
  const say = options.onProgress ?? (() => undefined);
  const deadline = Date.now() + timeoutMs;

  let found: { frame: PortalFrame; snapshot: GridSnapshot } | undefined;
  while (!found) {
    let login = false;
    for (const frame of page.frames()) {
      const snapshot = await probe(frame, readGridInPage);
      if (snapshot && snapshot.cells.length > 0) {
        found = { frame, snapshot };
        break;
      }
      login ||= Boolean(await probe(frame, hasLoginFormInPage));
    }
    if (found) break;
    if (login) throw new PortalLoginRequiredError();
    if (Date.now() >= deadline) {
      throw new StatementNotAvailableError(
        "The comparative statement did not open. It may not be published for this RFx yet.",
      );
    }
    await sleep(pollMs);
  }

  const cells = new Map<string, string>();
  const rows = new Set<number>();
  const columns = new Set<number>();
  let totalRows = 0;
  let totalColumns = 0;
  const absorb = (snapshot: GridSnapshot | null) => {
    if (!snapshot) return;
    totalRows = Math.max(totalRows, snapshot.totalRows);
    totalColumns = Math.max(totalColumns, snapshot.totalColumns);
    for (const [row, column, text] of snapshot.cells) {
      const known = cells.get(`${row}:${column}`);
      // One cell, two different values: the row numbering shifted under us. Store nothing.
      if (known && text && known !== text) {
        throw new StatementNotAvailableError("The comparative statement changed while it was being read");
      }
      if (known && !text) continue;
      cells.set(`${row}:${column}`, text);
      rows.add(row);
      columns.add(column);
    }
  };
  // Every cell, not just every row and column: a grid loaded in blocks can have seen each row and
  // each bidder while a whole block of rates is still missing.
  const complete = () => cells.size >= totalRows * totalColumns;

  absorb(found.snapshot);
  // Without the grid's own size there is no telling a full grid from a partly loaded one.
  if (totalRows === 0 || totalColumns === 0) {
    throw new StatementNotAvailableError("Could not confirm the size of the comparative statement grid");
  }
  // Down the rows first; when that runs out, one step right and back the other way, until a step
  // right moves nothing either. Each step tries the wheel, then the scrollbar button.
  let move: ScrollMove = "down";
  let vertical: "down" | "up" = "down";
  let position = found.snapshot.position ?? "";
  const progress = () => `${rows.size} of ${totalRows} rows, ${cells.size} of ${totalRows * totalColumns} cells`;
  say(`Statement grid found: ${totalRows} rows x ${totalColumns} columns. In the page so far: ${progress()}`);
  for (let scrolls = 0, idle = 0; !complete() && scrolls < maxScrolls; scrolls += 1) {
    const before = cells.size;
    await scroll(page, found.frame, move, idle === 1);
    const waitUntil = Date.now() + loadWaitMs;
    let moved = false;
    do {
      await sleep(settleMs);
      const before = cells.size;
      const snapshot = await probe(found.frame, readGridInPage);
      absorb(snapshot);
      moved = cells.size > before || (snapshot?.position ?? position) !== position;
      position = snapshot?.position ?? position;
    } while (!moved && Date.now() < waitUntil);
    say(
      `Scroll ${scrolls + 1} ${move}${idle === 1 ? " (scrollbar button)" : ""}: ` +
        `${cells.size > before ? "new cells" : moved ? "moved" : "nothing moved"}; ${progress()}`,
    );
    if (moved) {
      idle = 0;
      move = vertical;
    } else if (++idle === 2) {
      if (move === "right") break;
      vertical = vertical === "down" ? "up" : "down";
      move = "right";
      idle = 0;
    }
  }
  say(complete() ? `Complete: ${progress()}` : `Gave up incomplete: ${progress()}`);
  if (!complete()) {
    throw new StatementNotAvailableError(
      `Read only ${rows.size} of ${totalRows} rows and ${columns.size} of ${totalColumns} columns ` +
        `(${cells.size} of ${totalRows * totalColumns} cells) of the comparative statement`,
    );
  }

  const height = Math.max(...rows) + 1;
  const width = Math.max(...columns) + 1;
  return Array.from({ length: height }, (_row, row) =>
    Array.from({ length: width }, (_column, column) => cells.get(`${row}:${column}`) ?? ""),
  );
}
