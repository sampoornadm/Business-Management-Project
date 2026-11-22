/**
 * Next "<tender number>-RFQ-<n>" title. Counts every RFQ on the tender, so older RFQs with other
 * names still take a number, and goes past the highest used number, so deleting an RFQ never
 * makes the next one reuse a title.
 */
export function suggestRfqTitle(
  tenderNumber: string,
  existingTitles: string[],
  totalRfqs: number,
): string {
  const prefix = `${tenderNumber}-RFQ-`;
  const highest = existingTitles.reduce((max, title) => {
    const suffix = title.startsWith(prefix) ? title.slice(prefix.length) : "";
    return /^\d+$/.test(suffix) ? Math.max(max, Number(suffix)) : max;
  }, 0);
  return `${prefix}${Math.max(highest, totalRfqs) + 1}`;
}
