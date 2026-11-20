import { formatDate } from "@bmp/ui";

interface RfqTextItem {
  description: string;
  quantity: number;
  unit: string | null;
}

/**
 * Plain-text item list for pasting into WhatsApp: one "Sl No. | Item Desc | Qty | UoM" line per
 * item, then the tender's pinned requirements and the rate due date (each section omitted when
 * empty).
 */
export function buildRfqWhatsappText(
  items: RfqTextItem[],
  pinnedNotes: string[],
  dueDate: string | null,
): string {
  const sections = [
    [
      "Sl No. | Item Desc | Qty | UoM",
      ...items.map((item, i) => `${i + 1} | ${item.description} | ${item.quantity} | ${item.unit ?? "-"}`),
    ].join("\n"),
  ];
  if (pinnedNotes.length > 0) {
    sections.push(["Requirements:", ...pinnedNotes.map((note) => `- ${note}`)].join("\n"));
  }
  if (dueDate) sections.push(`Please send your rates by ${formatDate(dueDate)}.`);
  return sections.join("\n\n");
}
