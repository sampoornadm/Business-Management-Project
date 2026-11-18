import { describe, expect, it } from "vitest";

import { forecastRate } from "../rate-trend.js";

const d = (iso: string) => new Date(iso);

describe("forecastRate", () => {
  it("returns null with no history", () => {
    expect(forecastRate([], d("2026-11-14"))).toBeNull();
  });

  it("does not predict from one point", () => {
    expect(forecastRate([{ at: d("2026-10-23"), rate: 160 }], d("2026-11-14"))).toEqual({
      lastRate: 160,
      predictedRate: null,
      direction: null,
      points: 1,
    });
  });

  it("extends a falling line, clamped to the last observed step", () => {
    const f = forecastRate(
      [
        { at: d("2025-08-02"), rate: 168.5 },
        { at: d("2026-03-11"), rate: 163.5 },
        { at: d("2026-10-23"), rate: 160 },
      ],
      d("2027-10-23"),
    )!;
    expect(f.direction).toBe("FALLING");
    expect(f.predictedRate).toBeGreaterThanOrEqual(156.5); // the last step was 3.5
    expect(f.predictedRate).toBeLessThan(160);
    expect(f.lastRate).toBe(160);
    expect(f.points).toBe(3);
  });

  it("reports the trend of the history, however soon the next tender is", () => {
    const f = forecastRate(
      [
        { at: d("2025-08-02"), rate: 168.5 },
        { at: d("2026-03-11"), rate: 163.5 },
        { at: d("2026-10-23"), rate: 160 },
      ],
      d("2026-10-24"),
    )!;
    expect(f.direction).toBe("FALLING");
  });

  it("extends a rising line", () => {
    const f = forecastRate(
      [
        { at: d("2026-01-01"), rate: 100 },
        { at: d("2026-07-01"), rate: 110 },
      ],
      d("2027-01-01"),
    )!;
    expect(f.direction).toBe("RISING");
    expect(f.predictedRate).toBe(120);
  });

  it("is flat for identical rates", () => {
    const f = forecastRate(
      [
        { at: d("2026-01-01"), rate: 170 },
        { at: d("2026-06-01"), rate: 170 },
      ],
      d("2026-11-14"),
    )!;
    expect(f).toMatchObject({ predictedRate: 170, direction: "FLAT" });
  });

  it("survives two tenders opened the same day", () => {
    const f = forecastRate(
      [
        { at: d("2026-06-01"), rate: 100 },
        { at: d("2026-06-01"), rate: 110 },
      ],
      d("2026-11-14"),
    )!;
    expect(Number.isFinite(f.predictedRate)).toBe(true);
  });

  it("never predicts below zero", () => {
    const f = forecastRate(
      [
        { at: d("2026-01-01"), rate: 5 },
        { at: d("2026-02-01"), rate: 1 },
      ],
      d("2030-01-01"),
    )!;
    expect(f.predictedRate).toBeGreaterThanOrEqual(0);
  });

  it("orders points by date before fitting", () => {
    const a = { at: d("2026-01-01"), rate: 10 };
    const b = { at: d("2026-06-01"), rate: 20 };
    expect(forecastRate([b, a], d("2026-11-14"))).toEqual(forecastRate([a, b], d("2026-11-14")));
  });
});
