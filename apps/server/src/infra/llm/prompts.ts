/**
 * Prompt templates editable from Settings ("AI prompts" group). A template carries `{{name}}`
 * markers where live data is inserted; the answer format (JSON schema, Zod, sanity checks) stays
 * in code, so editing a prompt changes its wording, never what the app accepts back.
 */

/** Replaces every `{{name}}` with `values[name]`; markers with no value are left as written. */
export function renderPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (marker, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name) ? values[name]! : marker,
  );
}

/** Required markers the template no longer contains — the model would never see that data. */
export function missingMarkers(template: string, required: readonly string[]): string[] {
  return required.filter((name) => !template.includes(`{{${name}}}`));
}

export const RFQ_QUOTE_PASTE_DEFAULT_PROMPT = `You read rates that a vendor sent as a text message in reply to our request for quotation (RFQ).

These are the RFQ items exactly as we sent them to the vendor, one per line, as "item number) description - Qty - quantity unit":
{{items}}

These are the lines of the vendor's message that could not be read automatically. Each starts with its line id ("L" and a number):
{{lines}}

For every line, decide which RFQ item it quotes for and the rate.
Rules:
- The rate is the price for ONE unit. In "150@10/-" or "150 @ Rs 10", 150 is the quantity and 10 is the rate.
- Vendors often copy our item line and add their rate after it. In "3) Cement - Qty - 50 Bag - 380", 3 is the item number, 50 is the quantity and 380 is the rate. The number after "Qty" is never the rate; if a line has no other price, the rate is null.
- Numbers inside a description are sizes or specifications (for example "12X1.5", "4C x 16", "25 mm"), never prices.
- itemNumber is the number from the RFQ item list that the line refers to, matched by its serial number or by its description.
- If the vendor says they cannot supply the item ("regret", "not available", "NA"), set regretted to true and rate to null.
- If you are not sure which item a line refers to, or what the rate is, use null. Never guess and never calculate a rate.
- Return exactly one object per input line, with "line" set to that line's id (for example "L4").`;
