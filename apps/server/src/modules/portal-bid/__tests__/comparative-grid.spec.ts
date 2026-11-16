import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";

import {
  type GridSnapshot,
  hasLoginFormInPage,
  PortalLoginRequiredError,
  readComparativeGrid,
  readGridInPage,
  StatementNotAvailableError,
} from "../portal/comparative-grid.js";

type Cell = [number, number, string];

/** A frame that answers the three in-page probes from canned data instead of a DOM. */
class FakeFrame {
  scrolls = 0;
  constructor(
    private readonly script: {
      login?: boolean;
      /** One snapshot per scroll position; the last one repeats. */
      snapshots?: (GridSnapshot | null)[];
    },
  ) {}
  evaluate(fn: unknown): Promise<unknown> {
    if (fn === hasLoginFormInPage) return Promise.resolve(Boolean(this.script.login));
    if (fn === readGridInPage) {
      const snapshots = this.script.snapshots ?? [null];
      return Promise.resolve(snapshots[Math.min(this.scrolls, snapshots.length - 1)]);
    }
    return Promise.reject(new Error("unexpected in-page function"));
  }
}

const page = (...frames: FakeFrame[]) => ({ frames: () => frames }) as unknown as Page;
/** Stands in for the mouse: every scroll moves the fake frame on to its next snapshot. */
const moves: string[] = [];
const scroll = (_page: Page, frame: unknown, move: string, viaButton: boolean) => {
  moves.push(viaButton ? `${move} button` : move);
  (frame as FakeFrame).scrolls += 1;
  return Promise.resolve();
};
const fast = { timeoutMs: 60, pollMs: 5, settleMs: 0, loadWaitMs: 0, scroll };
const grid = (cells: Cell[], totalRows: number, totalColumns: number, position?: string): GridSnapshot => ({
  cells,
  totalRows,
  totalColumns,
  ...(position === undefined ? {} : { position }),
});

describe("readComparativeGrid", () => {
  it("returns the grid as a dense matrix, empty cells included", async () => {
    const frame = new FakeFrame({
      snapshots: [
        grid(
          [
            [0, 0, "Supplier Name"],
            [0, 1, "( 1 ) A"],
            [0, 2, "( 2 ) B"],
            [1, 0, "IGST"],
            [1, 1, ""],
            [1, 2, "18"],
          ],
          2,
          3,
        ),
      ],
    });
    expect(await readComparativeGrid(page(new FakeFrame({}), frame), fast)).toEqual([
      ["Supplier Name", "( 1 ) A", "( 2 ) B"],
      ["IGST", "", "18"],
    ]);
    expect(frame.scrolls).toBe(0);
  });

  it("scrolls and merges until every row the grid declares has been read", async () => {
    const frame = new FakeFrame({
      snapshots: [
        grid([[0, 0, "a"], [1, 0, "b"]], 4, 1),
        grid([[1, 0, "b"], [2, 0, "c"]], 4, 1),
        grid([[2, 0, "c"], [3, 0, "d"]], 4, 1),
      ],
    });
    expect(await readComparativeGrid(page(frame), fast)).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("keeps scrolling through rows it already has until the grid loads the next ones", async () => {
    const loaded: Cell[] = [[0, 0, "a"], [1, 0, "b"]];
    const frame = new FakeFrame({
      snapshots: [
        grid(loaded, 3, 1, "row 0"),
        grid(loaded, 3, 1, "row 1"),
        grid(loaded, 3, 1, "row 2"),
        grid(loaded, 3, 1, "row 3"),
        grid(loaded, 3, 1, "row 4"),
        grid(loaded, 3, 1, "row 5"),
        grid([[2, 0, "c"]], 3, 1, "row 6"),
      ],
    });
    expect(await readComparativeGrid(page(frame), fast)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("presses the scrollbar button when the mouse wheel moves nothing", async () => {
    const frame = new FakeFrame({
      snapshots: [grid([[0, 0, "a"]], 2, 1, "row 0"), grid([[0, 0, "a"]], 2, 1, "row 0"), grid([[1, 0, "b"]], 2, 1, "row 1")],
    });
    moves.length = 0;
    expect(await readComparativeGrid(page(frame), fast)).toEqual([["a"], ["b"]]);
    expect(moves).toEqual(["down", "down button"]);
  });

  it("scrolls sideways for bidder columns the grid has not loaded", async () => {
    const frame = new FakeFrame({
      snapshots: [
        grid([[0, 0, "a"], [1, 0, "b"]], 2, 2, "left"),
        grid([[0, 0, "a"], [1, 0, "b"]], 2, 2, "left"),
        grid([[0, 0, "a"], [1, 0, "b"]], 2, 2, "left"),
        grid([[0, 1, "c"], [1, 1, "d"]], 2, 2, "right"),
      ],
    });
    moves.length = 0;
    expect(await readComparativeGrid(page(frame), fast)).toEqual([["a", "c"], ["b", "d"]]);
    expect(moves.at(-1)).toMatch(/^right/);
  });

  it("refuses a grid with every row and column seen but cells still missing", async () => {
    const frame = new FakeFrame({ snapshots: [grid([[0, 0, "a"], [1, 1, "d"]], 2, 2)] });
    await expect(readComparativeGrid(page(frame), fast)).rejects.toThrow(/2 of 4 cells/);
  });

  it("refuses a grid whose cell changes between two reads", async () => {
    const frame = new FakeFrame({
      snapshots: [grid([[0, 0, "Basic Price"], [0, 1, "180.50"]], 2, 2, "row 0"), grid([[0, 1, "207.00"], [1, 0, "x"], [1, 1, "y"]], 2, 2, "row 1")],
    });
    await expect(readComparativeGrid(page(frame), fast)).rejects.toThrow(/changed while it was being read/);
  });

  it("refuses a grid it could not read completely", async () => {
    const frame = new FakeFrame({ snapshots: [grid([[0, 0, "a"], [1, 0, "b"]], 40, 1)] });
    await expect(readComparativeGrid(page(frame), fast)).rejects.toThrow(StatementNotAvailableError);
    await expect(readComparativeGrid(page(frame), fast)).rejects.toThrow(/2 of 40 rows/);
  });

  it("asks for a portal login instead of waiting when the logon form is showing", async () => {
    await expect(readComparativeGrid(page(new FakeFrame({ login: true })), fast)).rejects.toThrow(
      PortalLoginRequiredError,
    );
  });

  it("gives up when neither a statement nor a logon form appears", async () => {
    await expect(readComparativeGrid(page(new FakeFrame({})), fast)).rejects.toThrow(StatementNotAvailableError);
  });

  it("refuses a grid whose declared size it cannot find", async () => {
    const frame = new FakeFrame({ snapshots: [grid([[0, 0, "a"], [1, 0, "b"]], 0, 0)] });
    await expect(readComparativeGrid(page(frame), fast)).rejects.toThrow(StatementNotAvailableError);
    await expect(readComparativeGrid(page(frame), fast)).rejects.toThrow(/size/);
  });

  it("surfaces a script error from the page instead of reporting the statement as unpublished", async () => {
    const broken = { evaluate: () => Promise.reject(new ReferenceError("__name is not defined")) };
    await expect(readComparativeGrid({ frames: () => [broken] } as unknown as Page, fast)).rejects.toThrow(
      /__name is not defined/,
    );
  });

  it("keeps waiting through a frame that is navigating", async () => {
    let calls = 0;
    const navigating = {
      evaluate: (fn: unknown) => {
        calls += 1;
        if (calls <= 2) return Promise.reject(new Error("Execution context was destroyed, most likely because of a navigation"));
        return Promise.resolve(fn === readGridInPage ? grid([[0, 0, "a"]], 1, 1) : false);
      },
    };
    expect(await readComparativeGrid({ frames: () => [navigating] } as unknown as Page, fast)).toEqual([["a"]]);
  });

  // These two are serialised into the portal page. The server runs under tsx, whose bundler
  // wraps every *named* inner function in a `__name(...)` helper that does not exist in the page,
  // so a nested named function makes the whole read throw there (see portal-session.ts).
  it.each([
    ["readGridInPage", readGridInPage],
    ["hasLoginFormInPage", hasLoginFormInPage],
  ])("%s declares no named inner function", (_name, fn) => {
    const source = fn.toString();
    const body = source.slice(source.indexOf("{") + 1);
    expect(source).not.toContain("__name");
    expect(body).not.toMatch(/\b(?:const|let|var)\s+\w+\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/);
    expect(body).not.toMatch(/\bfunction\s+\w+\s*\(/);
  });

  it("waits for a grid that appears late", async () => {
    let reads = 0;
    const late = {
      evaluate: (fn: unknown) => {
        if (fn === hasLoginFormInPage) return Promise.resolve(false);
        reads += 1;
        return Promise.resolve(reads < 3 ? null : grid([[0, 0, "a"]], 1, 1));
      },
    };
    expect(await readComparativeGrid({ frames: () => [late] } as unknown as Page, fast)).toEqual([["a"]]);
  });
});
