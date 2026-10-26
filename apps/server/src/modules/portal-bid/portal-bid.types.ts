export type Widget = "text" | "combo" | "radio";

export type AnswerSource = "business" | "profile" | "tender";

export interface QuestionSpec {
  key: string;
  /** The portal's label text with whitespace collapsed, no trailing colon. */
  label: string;
  widget: Widget;
  source: AnswerSource;
  /** The row also has a free-text Comment cell (answered from profile key `<key>.comment`). */
  hasComment?: boolean;
}

export interface ResolvedAnswer {
  key: string;
  label: string;
  widget: Widget;
  value: string;
  comment?: string;
  source: AnswerSource;
}

export interface ItemPriceRow {
  itemCode: string;
  description: string;
  quantity: number;
  rate: number;
  cgstPct: number;
  sgstPct: number;
  igstPct: number;
}

export interface BidPayload {
  tenderNumber: string;
  answers: ResolvedAnswer[];
  items: ItemPriceRow[];
  /** Σ quantity × rate over `items`, GST excluded — what the portal's Total Value should show. */
  expectedTotal: number;
  warnings: string[];
}
