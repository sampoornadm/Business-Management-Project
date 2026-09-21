import type { AssistantDateRangeDto } from "@bmp/types";
import * as chrono from "chrono-node";

/**
 * Deterministic date-phrase resolution for the assistant. The LLM never does date arithmetic —
 * a small model asked for "last month" will happily be off by a month — so phrases are matched
 * and resolved here against an explicit clock and timezone.
 *
 * Ranges are half-open [from, to) UTC instants aligned to local midnights in `tz`.
 */

export interface DateResolveOptions {
  /**
   * Year-less dates ("in December", "12 Aug") normally mean the most recent occurrence — the
   * documents being searched already exist. Deadlines are the exception: "due in March" is upcoming.
   */
  allowFuture?: boolean;
}

export interface ResolvedDate {
  range: AssistantDateRangeDto;
  /** The exact substring of the message that was consumed, so callers can strip it. */
  matched: string;
}

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_PATTERN =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

// ---------- timezone helpers (Intl only, no library) ----------

function zonedParts(instant: Date, tz: string): Ymd & { hh: number; mm: number; ss: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute"), ss: get("second") };
}

export function tzOffsetMinutes(instant: Date, tz: string): number {
  const p = zonedParts(instant, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/** UTC instant of local midnight on the calendar date (month/day may overflow; Date.UTC normalises). */
function startOfLocalDay(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const off1 = tzOffsetMinutes(new Date(guess), tz);
  let t = guess - off1 * 60_000;
  const off2 = tzOffsetMinutes(new Date(t), tz); // second pass handles a DST boundary
  if (off2 !== off1) t = guess - off2 * 60_000;
  return new Date(t);
}

function make(from: Ymd, to: Ymd, label: string, tz: string): AssistantDateRangeDto {
  return {
    from: startOfLocalDay(from.y, from.m, from.d, tz).toISOString(),
    to: startOfLocalDay(to.y, to.m, to.d, tz).toISOString(),
    label,
  };
}

function monthLabel(y: number, m: number): string {
  return `${MONTHS[m - 1]!.replace(/^./, (c) => c.toUpperCase())} ${y}`;
}

export function formatLocalDate(instant: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short", year: "numeric" }).format(
    new Date(instant),
  );
}

// ---------- period arithmetic on calendar dates ----------

const addDays = (p: Ymd, n: number): Ymd => {
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
};
const addMonths = (p: Ymd, n: number): Ymd => {
  const d = new Date(Date.UTC(p.y, p.m - 1 + n, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: 1 };
};
/** Keeps "31 Mar minus 1 month" on 28/29 Feb instead of overflowing into March. */
const clampDay = (y: number, m: number, d: number): number => Math.min(d, new Date(Date.UTC(y, m, 0)).getUTCDate());
/** Monday of the week containing `p`. */
const weekStart = (p: Ymd): Ymd => {
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
  return addDays(p, -((dow + 6) % 7));
};
/** Indian financial year (1 Apr - 31 Mar): the calendar year in which the FY starts. */
const fyStartYear = (p: Ymd): number => (p.m >= 4 ? p.y : p.y - 1);

function fyRange(startYear: number, tz: string): AssistantDateRangeDto {
  const label = `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
  return make({ y: startYear, m: 4, d: 1 }, { y: startYear + 1, m: 4, d: 1 }, label, tz);
}

function rolling(today: Ymd, n: number, unit: string, tz: string): AssistantDateRangeDto {
  const to = addDays(today, 1);
  let from: Ymd;
  if (unit === "day") from = addDays(today, -n);
  else if (unit === "week") from = addDays(today, -7 * n);
  else if (unit === "month") {
    const first = addMonths(today, -n);
    from = { ...first, d: clampDay(first.y, first.m, today.d) };
  } else from = { y: today.y - n, m: today.m, d: clampDay(today.y - n, today.m, today.d) };
  return make(from, to, `last ${n} ${unit}${n === 1 ? "" : "s"}`, tz);
}

function calendarPeriod(today: Ymd, which: "this" | "last" | "next", unit: string, tz: string): AssistantDateRangeDto {
  const offset = which === "this" ? 0 : which === "last" ? -1 : 1;
  if (unit === "week") {
    const start = addDays(weekStart(today), 7 * offset);
    return make(start, addDays(start, 7), `${which} week`, tz);
  }
  if (unit === "month") {
    const start = addMonths(today, offset);
    return make(start, addMonths(start, 1), `${which} month (${monthLabel(start.y, start.m)})`, tz);
  }
  if (unit === "quarter") {
    const qStartMonth = Math.floor((today.m - 1) / 3) * 3 + 1;
    const start = addMonths({ y: today.y, m: qStartMonth, d: 1 }, 3 * offset);
    return make(start, addMonths(start, 3), `${which} quarter`, tz);
  }
  const y = today.y + offset; // year
  return make({ y, m: 1, d: 1 }, { y: y + 1, m: 1, d: 1 }, `${which} year (${y})`, tz);
}

// ---------- phrase matching ----------

/**
 * Finds the first date phrase in `message` and resolves it. Returns null when there is none, so
 * callers can treat "no date" and "unparseable" identically (the message is just not date-scoped).
 */
export function resolveDatePhrase(
  message: string,
  now: Date,
  tz: string,
  options: DateResolveOptions = {},
): ResolvedDate | null {
  const p = zonedParts(now, tz);
  const today: Ymd = { y: p.y, m: p.m, d: p.d };
  const done = (matched: string, range: AssistantDateRangeDto): ResolvedDate => ({ matched, range });

  let m = message.match(/\byesterday\b/i);
  if (m) return done(m[0], make(addDays(today, -1), today, "yesterday", tz));

  m = message.match(/\btoday\b/i);
  if (m) return done(m[0], make(today, addDays(today, 1), "today", tz));

  // Rolling window: "last 30 days", "past 3 months".
  m = message.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+(day|week|month|year)s?\b/i);
  if (m) return done(m[0], rolling(today, Number(m[1]), m[2]!.toLowerCase(), tz));

  // Financial year (India): "this financial year", "last FY", "FY 2025-26", "FY26".
  m = message.match(/\b(this|current|last|previous)\s+(?:financial\s+year|fy)\b/i);
  if (m) {
    const cur = fyStartYear(today);
    return done(m[0], fyRange(/^(this|current)$/i.test(m[1]!) ? cur : cur - 1, tz));
  }
  m = message.match(/\bfy\s*(20\d{2})\s*[-–/]\s*(?:20)?\d{2}\b/i);
  if (m) return done(m[0], fyRange(Number(m[1]), tz));
  m = message.match(/\bfy\s*'?(\d{2})\b/i);
  if (m) return done(m[0], fyRange(2000 + Number(m[1]) - 1, tz));

  // Calendar period: "this month", "last week", "previous quarter", "next month", "last year".
  m = message.match(/\b(this|current|last|previous|past|next)\s+(week|month|quarter|year)\b/i);
  if (m) {
    const word = m[1]!.toLowerCase();
    const which = word === "this" || word === "current" ? "this" : word === "next" ? "next" : "last";
    return done(m[0], calendarPeriod(today, which, m[2]!.toLowerCase(), tz));
  }

  // Month name with optional year: "in August", "August 2026". A bare day number next to the month
  // ("12 Aug", "Aug 12") is a specific date, which chrono handles below.
  const monthRe = new RegExp(`(?:\\b(in|during|for|of)\\s+)?\\b${MONTH_PATTERN}\\b(?:\\s+(?:of\\s+)?(20\\d{2}))?`, "i");
  const mm = monthRe.exec(message);
  if (mm) {
    const [whole, prefix, monthWord, year] = mm;
    const before = message.slice(0, mm.index);
    const after = message.slice(mm.index + whole.length);
    const adjacentDay = /\d{1,2}(?:st|nd|rd|th)?\s*$/i.test(before) || /^\s*\d{1,2}(?:st|nd|rd|th)?\b(?!\s*[-:])/i.test(after);
    const isModalMay = monthWord!.toLowerCase() === "may" && !prefix && !year;
    if (!adjacentDay && !isModalMay) {
      const monthIdx = MONTHS.findIndex((name) => name.startsWith(monthWord!.toLowerCase().slice(0, 3))) + 1;
      let y = today.y;
      if (year) y = Number(year);
      else if (options.allowFuture) y = monthIdx >= today.m ? today.y : today.y + 1; // next occurrence
      else if (monthIdx > today.m) y = today.y - 1; // most recent occurrence, never the future
      const start = { y, m: monthIdx, d: 1 };
      return done(whole.trim(), make(start, addMonths(start, 1), monthLabel(y, monthIdx), tz));
    }
  }

  m = message.match(/\b(?:in|during|for|of|year)\s+(20\d{2})\b/i);
  if (m) {
    const y = Number(m[1]);
    return done(m[0], make({ y, m: 1, d: 1 }, { y: y + 1, m: 1, d: 1 }, String(y), tz));
  }

  return resolveExplicitDates(message, now, tz, today, options);
}

/**
 * "12 Aug", "1 Aug to 15 Aug", "between 1 Aug and 15 Aug", "since 1 Sept", "before 10 March" via
 * chrono-node. Chrono only merges "X - Y" / "X to Y" into ranges, and misreads a leading
 * "from"/"between" ("from 1" becomes a time), so those words are blanked out (same length, so
 * indexes still line up with `message`) and the range pairing is done here.
 */
function resolveExplicitDates(
  message: string,
  now: Date,
  tz: string,
  today: Ymd,
  options: DateResolveOptions,
): ResolvedDate | null {
  const masked = message.replace(/\b(?:from|between)\b/gi, (w) => " ".repeat(w.length));
  const hits = chrono
    .parse(masked, { instant: now, timezone: tzOffsetMinutes(now, tz) }, { forwardDate: false })
    .filter((r) => r.start.isCertain("month") && r.start.isCertain("day"));
  const hit = hits[0];
  if (!hit) return null;

  type Comp = typeof hit.start;
  const toYmd = (c: Comp): Ymd => {
    const p = { y: c.get("year")!, m: c.get("month")!, d: c.get("day")! };
    // Chrono resolves a year-less date to whichever occurrence is nearest to now, which can be
    // next year ("10 March" said in September). For existing documents we want the past one.
    const inFuture = Date.UTC(p.y, p.m - 1, p.d) > Date.UTC(today.y, today.m - 1, today.d);
    return !c.isCertain("year") && inFuture && !options.allowFuture ? { ...p, y: p.y - 1 } : p;
  };
  const fmt = (p: Ymd): string => formatLocalDate(startOfLocalDay(p.y, p.m, p.d, tz), tz);
  const start = toYmd(hit.start);
  const before = message.slice(0, hit.index);
  const hitEnd = hit.index + hit.text.length;

  const second = hits[1];
  const joined = second && /^\s*(?:to|and|till|until|through|-|–)\s*$/i.test(message.slice(hitEnd, second.index));
  const end = hit.end ?? (joined ? second!.start : null);
  if (end) {
    const lastEnd = hit.end ? hitEnd : second!.index + second!.text.length;
    const lead = before.match(/\b(?:from|between)\s+$/i);
    const e = toYmd(end);
    return {
      matched: (lead ? lead[0] : "") + message.slice(hit.index, lastEnd),
      range: make(start, addDays(e, 1), `${fmt(start)} to ${fmt(e)}`, tz),
    };
  }

  const since = before.match(/\b(?:since|from|after|starting)\s+$/i);
  if (since) return { matched: since[0] + hit.text, range: make(start, addDays(today, 1), `since ${fmt(start)}`, tz) };
  const until = before.match(/\b(?:before|until|till|up\s*to)\s+$/i);
  if (until) {
    return { matched: until[0] + hit.text, range: make({ y: 2000, m: 1, d: 1 }, start, `before ${fmt(start)}`, tz) };
  }
  return { matched: hit.text, range: make(start, addDays(start, 1), fmt(start), tz) };
}
