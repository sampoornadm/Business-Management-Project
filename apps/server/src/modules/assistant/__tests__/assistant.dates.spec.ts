import { describe, expect, it } from "vitest";

import { formatLocalDate, resolveDatePhrase } from "../assistant.dates.js";

// 22 Sep 2026, 15:30 IST (a Tuesday).
const NOW = new Date("2026-09-22T10:00:00Z");
const TZ = "Asia/Kolkata";

const range = (message: string) => {
  const r = resolveDatePhrase(message, NOW, TZ);
  return r ? { from: r.range.from, to: r.range.to, label: r.range.label, matched: r.matched } : null;
};

describe("resolveDatePhrase", () => {
  it("resolves 'last month' to the previous calendar month at IST midnights", () => {
    expect(range("tenders I quoted last month for washers")).toEqual({
      from: "2026-07-31T18:30:00.000Z", // 1 Aug 00:00 IST
      to: "2026-08-31T18:30:00.000Z", // 1 Sep 00:00 IST
      label: "last month (August 2026)",
      matched: "last month",
    });
  });

  it("resolves this month, this year, last year", () => {
    expect(range("this month")).toMatchObject({ from: "2026-08-31T18:30:00.000Z", to: "2026-09-30T18:30:00.000Z" });
    expect(range("this year")).toMatchObject({ from: "2025-12-31T18:30:00.000Z", to: "2026-12-31T18:30:00.000Z" });
    expect(range("last year")).toMatchObject({ from: "2024-12-31T18:30:00.000Z", to: "2025-12-31T18:30:00.000Z" });
  });

  it("resolves 'next' periods for deadlines", () => {
    expect(range("due next month")).toMatchObject({
      from: "2026-09-30T18:30:00.000Z", // 1 Oct 00:00 IST
      to: "2026-10-31T18:30:00.000Z",
      label: "next month (October 2026)",
    });
    expect(range("next week")).toMatchObject({ from: "2026-09-27T18:30:00.000Z", to: "2026-10-04T18:30:00.000Z" });
    expect(range("next year")).toMatchObject({ label: "next year (2027)" });
  });

  it("uses Monday-based weeks", () => {
    // Tue 22 Sep -> this week = Mon 21 Sep .. Mon 28 Sep
    expect(range("this week")).toMatchObject({ from: "2026-09-20T18:30:00.000Z", to: "2026-09-27T18:30:00.000Z" });
    expect(range("last week")).toMatchObject({ from: "2026-09-13T18:30:00.000Z", to: "2026-09-20T18:30:00.000Z" });
  });

  it("resolves quarters", () => {
    expect(range("this quarter")).toMatchObject({ from: "2026-06-30T18:30:00.000Z", to: "2026-09-30T18:30:00.000Z" });
    expect(range("last quarter")).toMatchObject({ from: "2026-03-31T18:30:00.000Z", to: "2026-06-30T18:30:00.000Z" });
  });

  it("resolves rolling windows up to the end of today", () => {
    expect(range("in the last 30 days")).toMatchObject({
      from: "2026-08-22T18:30:00.000Z", // 23 Aug 00:00 IST (22 Sep minus 30 days)
      to: "2026-09-22T18:30:00.000Z",
      label: "last 30 days",
    });
    expect(range("last 3 months")).toMatchObject({ from: "2026-06-21T18:30:00.000Z", to: "2026-09-22T18:30:00.000Z" });
  });

  it("resolves today and yesterday", () => {
    expect(range("yesterday")).toMatchObject({ from: "2026-09-20T18:30:00.000Z", to: "2026-09-21T18:30:00.000Z" });
    expect(range("today")).toMatchObject({ from: "2026-09-21T18:30:00.000Z", to: "2026-09-22T18:30:00.000Z" });
  });

  it("resolves Indian financial years", () => {
    expect(range("this financial year")).toMatchObject({ from: "2026-03-31T18:30:00.000Z", to: "2027-03-31T18:30:00.000Z", label: "FY 2026-27" });
    expect(range("last FY")).toMatchObject({ label: "FY 2025-26" });
    expect(range("FY 2024-25")).toMatchObject({ from: "2024-03-31T18:30:00.000Z", to: "2025-03-31T18:30:00.000Z" });
    expect(range("fy26")).toMatchObject({ label: "FY 2025-26" });
  });

  it("resolves month names to the most recent occurrence, never the future", () => {
    expect(range("quoted in August")).toMatchObject({ from: "2026-07-31T18:30:00.000Z", to: "2026-08-31T18:30:00.000Z", matched: "in August" });
    expect(range("in December")).toMatchObject({ label: "December 2025" });
    expect(range("March 2024")).toMatchObject({ label: "March 2024" });
  });

  it("does not treat the modal verb 'may' as a month", () => {
    expect(resolveDatePhrase("which tenders may I open", NOW, TZ)).toBeNull();
    expect(range("in May")).toMatchObject({ label: "May 2026" });
  });

  it("resolves a calendar year", () => {
    expect(range("during 2025")).toMatchObject({ from: "2024-12-31T18:30:00.000Z", to: "2025-12-31T18:30:00.000Z", label: "2025" });
  });

  it("handles explicit dates and ranges via chrono", () => {
    expect(range("on 12 Aug")).toMatchObject({ from: "2026-08-11T18:30:00.000Z", to: "2026-08-12T18:30:00.000Z" });
    expect(range("from 1 Aug to 15 Aug")).toMatchObject({ from: "2026-07-31T18:30:00.000Z", to: "2026-08-15T18:30:00.000Z", matched: "from 1 Aug to 15 Aug" });
    expect(range("between 1 Aug and 15 Aug")).toMatchObject({ from: "2026-07-31T18:30:00.000Z", to: "2026-08-15T18:30:00.000Z" });
    expect(range("1 Aug - 15 Aug")).toMatchObject({ to: "2026-08-15T18:30:00.000Z" });
    expect(range("since 1 Sep")).toMatchObject({ from: "2026-08-31T18:30:00.000Z", to: "2026-09-22T18:30:00.000Z" });
    expect(range("before 10 March")).toMatchObject({ to: "2026-03-09T18:30:00.000Z" });
  });

  it("lets deadlines look forward for year-less dates", () => {
    const upcoming = resolveDatePhrase("due in March", NOW, TZ, { allowFuture: true });
    expect(upcoming?.range.label).toBe("March 2027");
    expect(resolveDatePhrase("due 10 October", NOW, TZ, { allowFuture: true })?.range.from).toBe("2026-10-09T18:30:00.000Z");
    expect(range("due 10 October")).toMatchObject({ from: "2025-10-09T18:30:00.000Z" }); // default: past
  });

  it("returns null when there is no date phrase", () => {
    expect(resolveDatePhrase("show me the tenders for washers", NOW, TZ)).toBeNull();
    expect(resolveDatePhrase("cable 4C x 16 sqmm", NOW, TZ)).toBeNull();
  });

  it("keeps month arithmetic on the last valid day (31 Mar - 1 month)", () => {
    const march31 = new Date("2026-03-31T10:00:00Z");
    expect(resolveDatePhrase("last 1 month", march31, TZ)?.range.from).toBe("2026-02-27T18:30:00.000Z"); // 28 Feb IST
  });

  it("formats local dates", () => {
    expect(formatLocalDate("2026-08-31T20:00:00Z", TZ)).toBe("1 Sept 2026");
  });
});
