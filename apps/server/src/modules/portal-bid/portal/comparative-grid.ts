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
}

export interface ReadGridOptions {
  timeoutMs?: number;
  pollMs?: number;
  settleMs?: number;
  maxScrolls?: number;
}

// The three functions below run inside the portal page (Playwright serialises them), so they
// may only use the DOM and their own locals.

/**
 * The comparative statement is an SAP WebGUI ALV grid. Every cell is a
 * `<td lsmatrixrowindex lsmatrixcolindex>`, and the grid's own metadata carries `totalRows` /
 * `totalColumns`, which is how a partly loaded grid is told apart from a complete one.
 */
export function readGridInPage(): GridSnapshot | null {
  const tds = Array.from(document.querySelectorAll("td[lsmatrixrowindex][lsmatrixcolindex]"));
  if (tds.length === 0) return null;
  const cells = tds.map((td): [number, number, string] => [
    Number(td.getAttribute("lsmatrixrowindex")),
    Number(td.getAttribute("lsmatrixcolindex")),
    (td.textContent ?? "").replace(/[\s\u00a0]+/g, " ").trim(),
  ]);
  const meta = Array.from(document.querySelectorAll('[lsdata*="totalRows"]'))
    .map((element) => element.getAttribute("lsdata") ?? "")
    .concat(document.documentElement.innerHTML)
    .find((text) => /totalRows\D{1,8}\d+/.test(text));
  const declared = (name: string) => {
    const match = new RegExp(`${name}\\D{1,8}(\\d+)`).exec(meta ?? "");
    return match ? Number(match[1]) : 0;
  };
  return { cells, totalRows: declared("totalRows"), totalColumns: declared("totalColumns") };
}

export function hasLoginFormInPage(): boolean {
  return document.querySelector('form#certLogonForm, form[name="logonForm"], input[type="password"]') !== null;
}

/** Moves the grid's scroll areas on by most of a screen, so a long grid loads its next rows. */
export function scrollGridInPage(): void {
  // ponytail: best-effort scrolling, not yet seen against a grid large enough for SAP to page it
  // from the server (> ~4000 cells). The caller's completeness check is what guards the data.
  const cell = document.querySelector("td[lsmatrixrowindex]");
  for (let node = cell?.parentElement; node; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1) {
      const before = node.scrollTop;
      node.scrollTop += Math.max(40, Math.floor(node.clientHeight * 0.8));
      if (node.scrollTop === before && node.scrollWidth > node.clientWidth + 1) {
        node.scrollLeft += Math.max(40, Math.floor(node.clientWidth * 0.8));
        node.scrollTop = 0;
      }
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Waits for the statement grid in any frame of `page` and returns it as a dense matrix
 * (`matrix[row][column]`, `""` for an empty cell). Never returns a partial grid.
 */
export async function readComparativeGrid(page: Page, options: ReadGridOptions = {}): Promise<string[][]> {
  const { timeoutMs = 30_000, pollMs = 500, settleMs = 400, maxScrolls = 200 } = options;
  const deadline = Date.now() + timeoutMs;

  let found: { frame: ReturnType<Page["frames"]>[number]; snapshot: GridSnapshot } | undefined;
  while (!found) {
    let login = false;
    for (const frame of page.frames()) {
      const snapshot = await frame.evaluate(readGridInPage).catch(() => null);
      if (snapshot && snapshot.cells.length > 0) {
        found = { frame, snapshot };
        break;
      }
      login ||= await frame.evaluate(hasLoginFormInPage).catch(() => false);
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
      cells.set(`${row}:${column}`, text);
      rows.add(row);
      columns.add(column);
    }
  };
  const complete = () => rows.size >= totalRows && columns.size >= totalColumns;

  absorb(found.snapshot);
  for (let scrolls = 0, stalled = 0; !complete() && scrolls < maxScrolls && stalled < 3; scrolls += 1) {
    await found.frame.evaluate(scrollGridInPage).catch(() => undefined);
    await sleep(settleMs);
    const before = cells.size;
    absorb(await found.frame.evaluate(readGridInPage).catch(() => null));
    stalled = cells.size === before ? stalled + 1 : 0;
  }
  if (!complete()) {
    throw new StatementNotAvailableError(
      `Read only ${rows.size} of ${totalRows} rows and ${columns.size} of ${totalColumns} columns of the comparative statement`,
    );
  }

  const height = Math.max(...rows) + 1;
  const width = Math.max(...columns) + 1;
  return Array.from({ length: height }, (_row, row) =>
    Array.from({ length: width }, (_column, column) => cells.get(`${row}:${column}`) ?? ""),
  );
}
