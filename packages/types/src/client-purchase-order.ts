import type { AttachmentDto } from "./attachment.js";

/**
 * Checks of one client PO line against our current BOQ, derived on read (never stored):
 * - NOT_IN_BOQ: the line is not linked to any line of our current BOQ.
 * - RATE_MISMATCH: the PO rate differs from the rate we quoted.
 * - QTY_ABOVE_BOQ: the client ordered more than the BOQ quantity (across all its POs).
 * - UNIT_MISMATCH: the PO unit differs from the BOQ unit.
 */
export const CLIENT_PO_ITEM_FLAGS = ["NOT_IN_BOQ", "RATE_MISMATCH", "QTY_ABOVE_BOQ", "UNIT_MISMATCH"] as const;
export type ClientPoItemFlag = (typeof CLIENT_PO_ITEM_FLAGS)[number];

export interface ClientPurchaseOrderItemDto {
  id: string;
  boqItemId: string | null;
  itemCode: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  rate: number;
  amount: number;
  sortOrder: number;
  /** Our rate on the linked BOQ line; null when unlinked or the line has no rate. */
  quotedRate: number | null;
  boqQuantity: number | null;
  boqUnit: string | null;
  flags: ClientPoItemFlag[];
}

export interface ClientPurchaseOrderDto {
  id: string;
  projectId: string;
  poNumber: string;
  poDate: string;
  deliveryDueDate: string;
  notes: string | null;
  /** Σ item quantity × rate. */
  poValue: number;
  items: ClientPurchaseOrderItemDto[];
  /** The PO document as received from the client, newest first. */
  documents: AttachmentDto[];
  createdBy: { id: string; firstName: string; lastName: string };
  createdAt: string;
  updatedAt: string;
}

/** A priced line of our current BOQ that no client PO of the project orders yet. */
export interface UnorderedBoqItemDto {
  boqItemId: string;
  itemCode: string | null;
  description: string;
  unit: string | null;
  quantity: number | null;
  rate: number | null;
}

export interface ProjectClientPurchaseOrdersDto {
  orders: ClientPurchaseOrderDto[];
  /** BOQ lines we expected to be ordered (the won lines, else every priced line) but no PO orders. */
  unorderedBoqItems: UnorderedBoqItemDto[];
  totalValue: number;
  /** Earliest delivery due date across the project's POs; drives the countdown. */
  earliestDueDate: string | null;
}

export interface ClientPurchaseOrderItemInput {
  /** Set when editing an existing line, so a shipped line keeps its identity. */
  id?: string;
  boqItemId?: string | null;
  itemCode?: string | null;
  description: string;
  unit?: string | null;
  quantity: number;
  rate: number;
}

export interface CreateClientPurchaseOrderInput {
  poNumber: string;
  poDate: string;
  /** Defaults to poDate + the tender's delivery period. */
  deliveryDueDate?: string;
  notes?: string | null;
  items: ClientPurchaseOrderItemInput[];
}

/** `items`, when sent, replaces every line of the PO. */
export type UpdateClientPurchaseOrderInput = Partial<CreateClientPurchaseOrderInput>;

/** Fields read out of an uploaded client PO document; a draft for the form, nothing is saved. */
export interface ClientPurchaseOrderExtractionDto {
  poNumber?: string;
  poDate?: string;
  deliveryDueDate?: string;
  /** The total the document itself states, to compare with Σ items. */
  documentTotal?: number;
  items: ClientPurchaseOrderItemInput[];
  warnings: string[];
}
