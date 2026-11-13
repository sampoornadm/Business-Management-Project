import type { Page } from "playwright-core";
import { describe, expect, it } from "vitest";

import {
  type GridSnapshot,
  hasLoginFormInPage,
  PortalLoginRequiredError,
  readComparativeGrid,
  readGridInPage,
  scrollGridInPage,
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
    if (fn === scrollGridInPage) {
      this.scrolls += 1;
      return Promise.resolve();
    }
    if (fn === readGridInPage) {
      const snapshots = this.script.snapshots ?? [null];
      return Promise.resolve(snapshots[Math.min(this.scrolls, snapshots.length - 1)]);
    }
    return Promise.reject(new Error("unexpected in-page function"));
  }
}

const page = (...frames: FakeFrame[]) => ({ frames: () => frames }) as unknown as Page;
const fast = { timeoutMs: 60, pollMs: 5, settleMs: 0 };
const grid = (cells: Cell[], totalRows: number, totalColumns: number): GridSnapshot => ({ cells, totalRows, totalColumns });

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
