export interface RfqTextItem {
  description: string;
  unit: string | null;
  quantity: number;
}

export interface BuildRfqTextParams {
  items: RfqTextItem[];
  vendorContactName: string;
  tenderNumber?: string;
  senderName: string;
  senderEmail: string;
}

// Plain text only — no letterhead/PDF (that's a separate future phase). The
// user reviews and can edit this before it's actually sent; the server never
// regenerates it once quick-send is called.
export function buildRfqText({
  items,
  vendorContactName,
  tenderNumber,
  senderName,
  senderEmail,
}: BuildRfqTextParams): string {
  const itemLines = items
    .map((item, index) => `${index + 1}. ${item.description} — Qty: ${item.quantity}${item.unit ? ` ${item.unit}` : ""}`)
    .join("\n");

  const tenderRef = tenderNumber ? ` against tender ${tenderNumber}` : "";

  return [
    `Dear ${vendorContactName},`,
    "",
    `We would like to request your best quotation for the following item(s)${tenderRef}:`,
    "",
    itemLines,
    "",
    "Please share your quoted rates, delivery timeline, and validity period at your earliest convenience.",
    "",
    "Regards,",
    senderName,
    senderEmail,
  ].join("\n");
}
