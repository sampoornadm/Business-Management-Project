import type { AttachmentDto } from "./attachment.js";
import type { CreatePaymentInput } from "./finance.js";

/**
 * Where a shipment is, derived from what has been recorded on it (never stored):
 * PREPARING (items picked) → DISPATCHED (e-way bill, sent) → GRN_RECEIVED (client's GRN)
 * → BILLED (bill raised) → PAID (client's payment closed).
 */
export const SHIPMENT_STAGES = ["PREPARING", "DISPATCHED", "GRN_RECEIVED", "BILLED", "PAID"] as const;
export type ShipmentStage = (typeof SHIPMENT_STAGES)[number];

export const SHIPMENT_DOCUMENT_TYPES = ["EWAY_BILL", "TECHNICAL", "GRN", "OTHER"] as const;
export type ShipmentDocumentType = (typeof SHIPMENT_DOCUMENT_TYPES)[number];

export interface ShipmentItemDto {
  id: string;
  clientPoItemId: string;
  boqItemId: string | null;
  description: string;
  unit: string | null;
  quantity: number;
  /** The client PO rate; what the bill charges. */
  rate: number;
  amount: number;
}

export interface ShipmentDto {
  id: string;
  projectId: string;
  number: number;
  clientPurchaseOrderId: string;
  clientPoNumber: string;
  stage: ShipmentStage;
  items: ShipmentItemDto[];
  /** Σ item quantity × client PO rate. */
  value: number;
  ewayBillNumber: string | null;
  ewayBillDate: string | null;
  vehicleNumber: string | null;
  transporterName: string | null;
  freightCost: number | null;
  dispatchedAt: string | null;
  grnNumber: string | null;
  grnDate: string | null;
  bill: { id: string; billNumber: string; total: number } | null;
  /** Σ payments recorded against the bill. */
  amountReceived: number;
  settledAt: string | null;
  notes: string | null;
  documents: AttachmentDto[];
  createdAt: string;
  updatedAt: string;
}

export interface SupplyVendorPoLineDto {
  purchaseOrderId: string;
  poNumber: string;
  vendorName: string;
  status: "DRAFT" | "ISSUED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
  quantity: number;
  receivedQuantity: number;
}

/**
 * One thing the client ordered, followed through the supply chain. Lines are grouped by BOQ line
 * (split POs for the same line add up); a client PO line not in our BOQ is its own row.
 */
export interface SupplyLineDto {
  key: string;
  boqItemId: string | null;
  itemCode: string | null;
  description: string;
  unit: string | null;
  /** Σ client PO quantity. */
  ordered: number;
  /** Σ quantity on our non-cancelled vendor POs for this line. */
  procured: number;
  received: number;
  dispatched: number;
  /** Shipped quantity whose shipment has a GRN. */
  accepted: number;
  vendorPurchaseOrders: SupplyVendorPoLineDto[];
}

export interface ProjectSupplyDto {
  lines: SupplyLineDto[];
  shipments: ShipmentDto[];
}

export interface ShipmentItemInput {
  clientPoItemId: string;
  quantity: number;
}

export interface CreateShipmentInput {
  clientPurchaseOrderId: string;
  items: ShipmentItemInput[];
  notes?: string | null;
}

/** Items can change only while the shipment is still being prepared. */
export interface UpdateShipmentInput {
  items?: ShipmentItemInput[];
  notes?: string | null;
  vehicleNumber?: string | null;
  transporterName?: string | null;
  freightCost?: number | null;
}

export interface DispatchShipmentInput {
  ewayBillNumber: string;
  ewayBillDate: string;
  dispatchedAt?: string;
  vehicleNumber?: string | null;
  transporterName?: string | null;
  freightCost?: number | null;
}

export interface RecordShipmentGrnInput {
  grnNumber: string;
  grnDate: string;
}

export interface RecordShipmentPaymentInput extends CreatePaymentInput {
  /** True when this closes the client's payment for the shipment (in full or net of deductions). */
  settled: boolean;
}

/** Documents the project's "Read a document" step understands. */
export const READABLE_DOCUMENT_KINDS = ["EWAY_BILL", "GRN", "VENDOR_INVOICE"] as const;
export type ReadableDocumentKind = (typeof READABLE_DOCUMENT_KINDS)[number];

/**
 * What a read document says and where it belongs. Nothing is saved: the user confirms in the
 * dispatch / GRN dialog (or on the vendor PO) as usual.
 */
export interface ReadDocumentResultDto {
  /** null when the document could not be recognised. */
  kind: ReadableDocumentKind | null;
  /** IISCO = the format-specific reader for SAIL IISCO documents; AI = the local model. */
  reader: "IISCO" | "AI" | null;
  /** E-way bill no., GRN no. or invoice no., depending on kind. */
  documentNumber: string | null;
  /** YYYY-MM-DD. */
  documentDate: string | null;
  /** The PO the document quotes: the client PO for an e-way bill/GRN, our vendor PO for an invoice. */
  poNumber: string | null;
  vehicleNumber: string | null;
  transporterName: string | null;
  /** Invoice total. */
  amount: number | null;
  clientPurchaseOrderId: string | null;
  /** Shipments this e-way bill / GRN can be recorded on; one entry means a clear match. */
  shipmentIds: string[];
  /** The vendor PO a vendor invoice belongs to. */
  purchaseOrder: { id: string; poNumber: string; vendorName: string; total: number } | null;
  warnings: string[];
}
