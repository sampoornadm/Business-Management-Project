import { formatDate } from "@bmp/ui";

interface RfqTextItem {
  description: string;
  quantity: number;
  unit: string | null;
}

/**
 * Plain-text item list for pasting into a chat or text message: one "<Sl No>) <Item Desc> - Qty - <Qty> <Unit>" line
 * per item, then the tender's pinned requirements and the rate due date (each section omitted when
 * empty).
 */
export function buildRfqItemListText(
  items: RfqTextItem[],
  pinnedNotes: string[],
  dueDate: string | null,
): string {
  const sections = [
    items
      .map((item, i) => `${i + 1}) ${item.description} - Qty - ${item.quantity}${item.unit ? ` ${item.unit}` : ""}`)
      .join("\n"),
  ];
  if (pinnedNotes.length > 0) {
    sections.push(["Requirements:", ...pinnedNotes.map((note) => `- ${note}`)].join("\n"));
  }
  if (dueDate) sections.push(`Please send your rates by ${formatDate(dueDate)}.`);
  return sections.join("\n\n");
}
