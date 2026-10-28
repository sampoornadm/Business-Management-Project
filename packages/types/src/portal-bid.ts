export type PortalQuestionWidget = "text" | "combo" | "radio";
export type PortalAnswerSource = "business" | "profile" | "tender";

/** One row of a business's answer sheet for a buyer portal (SAIL ISP today). */
export interface PortalProfileQuestionDto {
  key: string;
  label: string;
  widget: PortalQuestionWidget;
  /** `profile` answers are edited here; `business` ones come from the Business record, `tender` ones from each tender. */
  source: PortalAnswerSource;
  /** What the portal will be given: the stored answer, or for a `business` row the business record's value. */
  value: string;
  /** Only `profile` rows are editable. */
  editable: boolean;
  hasComment: boolean;
  comment: string;
}

export interface PortalProfileDto {
  portalCode: string;
  businessId: string;
  businessName: string;
  questions: PortalProfileQuestionDto[];
}

export interface UpdatePortalProfileInput {
  /** Question key (or `<key>.comment`) to new text; an empty string clears the stored answer. */
  answers: Record<string, string>;
}

export type PortalFillStatus = "running" | "done" | "failed";

export interface PortalFillResultDto {
  responseNumber: string;
  filled: number;
  skipped: string[];
  mismatches: string[];
  warnings: string[];
  saved: boolean;
}

export interface PortalFillJobDto {
  id: string;
  tenderId: string;
  status: PortalFillStatus;
  /** 0-100: the first half is the Questions page, the second half the item prices. */
  progress: number;
  result?: PortalFillResultDto;
  error?: string;
}

export interface PortalBrowserStatusDto {
  /** The bundled browser window is open. */
  open: boolean;
  /** A SAIL ISP bid response is showing in it, so a fill can start. */
  onResponsePage: boolean;
  rfxNumber?: string;
  responseNumber?: string;
}
