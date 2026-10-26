const DAYS_PER_UNIT: Record<string, number> = { day: 1, week: 7, month: 30 };

// A sentence about payment/validity/warranty can mention "delivery" and a day count without
// stating how long delivery may take ("payment within 30 days of delivery").
const NOT_A_DELIVERY_PERIOD = /\b(pay|payment|invoice|bill|warranty|guarantee|valid|validity)\b/i;
const DELIVERY_WORD = /\b(deliver\w*|supply|supplied|completion)\b/i;
// Allows a number spelled out in brackets after the digits: "30 (thirty) days".
const PERIOD = /(\d+(?:\.\d+)?)\s*(?:\([^)]*\)\s*)?(day|week|month)s?\b/gi;

/**
 * The delivery period (in days) a tender's notes ask for, or null when they state none. When
 * several are stated the shortest wins — it is the one the bid has to be able to meet.
 * Computed on read from the notes text rather than stored, so editing the notes can never leave
 * it stale.
 */
export function parseDeliveryDaysFromNotes(notes: string | null | undefined): number | null {
  if (!notes) return null;
  const periods: number[] = [];
  // Split on newlines and on a full stop followed by whitespace, so "1.5 months" stays whole.
  for (const sentence of notes.split(/\n|(?<=[.;])\s+/)) {
    if (!DELIVERY_WORD.test(sentence)) continue;
    // The payment/validity exclusion applies per clause: "Delivery: 4 weeks, Payment: within
    // 30 days" is one line with a delivery period and a payment term side by side.
    for (const clause of sentence.split(/,\s+/)) {
      if (NOT_A_DELIVERY_PERIOD.test(clause)) continue;
      for (const match of clause.matchAll(PERIOD)) {
        periods.push(Math.round(Number(match[1]) * DAYS_PER_UNIT[match[2]!.toLowerCase()]!));
      }
    }
  }
  return periods.length > 0 ? Math.min(...periods) : null;
}
