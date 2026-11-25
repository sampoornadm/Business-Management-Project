import { formatRfqItemTextLine } from "@bmp/types";
import { formatDate } from "@bmp/ui";

interface RfqTextItem {
  description: string;
  quantity: number;
  unit: string | null;
}

/**
 * Plain-text item list for pasting into a chat or text message: one formatRfqItemTextLine per
 * item, then the tender's pinned requirements and the rate due date (each section omitted when
 * empty).
 */
export function buildRfqItemListText(
  items: RfqTextItem[],
  pinnedNotes: string[],
  dueDate: string | null,
): string {
  const sections = [
    items.map((item, i) => formatRfqItemTextLine(i + 1, item)).join("\n"),
  ];
  if (pinnedNotes.length > 0) {
    sections.push(["Requirements:", ...pinnedNotes.map((note) => `- ${note}`)].join("\n"));
  }
  if (dueDate) sections.push(`Please send your rates by ${formatDate(dueDate)}.`);
  return sections.join("\n\n");
}
