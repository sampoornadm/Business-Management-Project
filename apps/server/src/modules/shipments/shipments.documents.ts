import type { ReadableDocumentKind, ReadDocumentResultDto } from "@bmp/types";
import { z } from "zod";

import { NotFoundError } from "../../core/errors/HttpErrors.js";
import { round2 } from "../../shared/utils/math.js";
import type { ExtractTextFn, GenerateJsonFn } from "../tenders/tender-extraction.service.js";

import { shipmentStage } from "./shipments.logic.js";
import type { IShipmentsRepository } from "./shipments.repository.js";

const MAX_PROMPT_CHARS = 12_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const KIND_PATTERNS: Record<ReadableDocumentKind, RegExp> = {
  EWAY_BILL: /e\s*-?\s*way\s*bill/i,
  GRN: /goods\s+receipt|receipt\s+note|material\s+receipt|\bG\.?R\.?N\b/i,
  VENDOR_INVOICE: /\binvoice\b/i,
};

/**
 * Each of these documents mentions the others (an invoice prints its e-way bill number, a GRN
 * quotes the invoice), so the kind is whichever phrase appears first: the document's own title.
 */
export function detectDocumentKind(text: string): ReadableDocumentKind | null {
  let best: { kind: ReadableDocumentKind; at: number } | null = null;
  for (const [kind, pattern] of Object.entries(KIND_PATTERNS) as [ReadableDocumentKind, RegExp][]) {
    const at = text.search(pattern);
    if (at >= 0 && (!best || at < best.at)) best = { kind, at };
  }
  return best?.kind ?? null;
}

export function isSailIiscoDocument(text: string): boolean {
  return /\bIISCO\b|Steel Authority of India/i.test(text);
}

export interface DocumentFields {
  documentNumber: string | null;
  documentDate: string | null;
  poNumber: string | null;
  vehicleNumber: string | null;
  transporterName: string | null;
  amount: number | null;
}

/**
 * SAIL IISCO documents follow a fixed format, so they get a deterministic reader instead of the
 * model. Returns null when no reader exists for this kind yet, and the model reads it instead.
 */
// ponytail: no IISCO reader is written yet; add one per kind (GRN first) once sample documents
// show the exact layout, and cover it with a test on an anonymised copy.
export function readIiscoDocument(_kind: ReadableDocumentKind, _text: string): DocumentFields | null {
  return null;
}

/** PO and document numbers compared without spaces, slashes, dashes or case. */
export function sameReference(a: string | null | undefined, b: string | null | undefined): boolean {
  const clean = (value: string) => value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  return !!a && !!b && clean(a) !== "" && clean(a) === clean(b);
}

const fieldsSchema = z.object({
  documentNumber: z.coerce.string().nullish(),
  documentDate: z.string().nullish(),
  poNumber: z.coerce.string().nullish(),
  vehicleNumber: z.string().nullish(),
  transporterName: z.string().nullish(),
  amount: z.coerce.number().nullish(),
});

const KIND_DESCRIPTION: Record<ReadableDocumentKind, string> = {
  EWAY_BILL: `an e-way bill for goods a supplier is sending to its client.
- "documentNumber": the e-way bill number (EWB No.)
- "documentDate": the e-way bill's generated date
- "poNumber": the client's purchase order number, if printed
- "vehicleNumber": the vehicle number
- "transporterName": the transporter's name`,
  GRN: `a goods receipt note (GRN) the client issued after receiving a supplier's goods.
- "documentNumber": the GRN number
- "documentDate": the GRN date
- "poNumber": the purchase order number it was received against`,
  VENDOR_INVOICE: `a tax invoice a vendor sent us for goods we ordered from them.
- "documentNumber": the invoice number
- "documentDate": the invoice date
- "poNumber": our purchase order number that the invoice quotes
- "amount": the invoice's grand total as a plain number (no currency symbol, no commas)`,
};

function fieldsPrompt(kind: ReadableDocumentKind, text: string): string {
  return `You are reading ${KIND_DESCRIPTION[kind]}
Return ONLY a single JSON object (no markdown, no explanation) with exactly the keys
"documentNumber", "documentDate", "poNumber", "vehicleNumber", "transporterName", "amount".
Dates as YYYY-MM-DD. Use null for anything the document does not state or that is not listed above. Do not guess.

Document text:
"""
${text.slice(0, MAX_PROMPT_CHARS)}
"""`;
}

const EMPTY_FIELDS: DocumentFields = {
  documentNumber: null,
  documentDate: null,
  poNumber: null,
  vehicleNumber: null,
  transporterName: null,
  amount: null,
};

const KIND_NAME: Record<ReadableDocumentKind, string> = {
  EWAY_BILL: "e-way bill",
  GRN: "GRN",
  VENDOR_INVOICE: "vendor invoice",
};

export type DocumentReaderRepository = Pick<
  IShipmentsRepository,
  "findProject" | "findManyByProject" | "findClientPurchaseOrders" | "findVendorPurchaseOrders"
>;

/** Reads an e-way bill, GRN or vendor invoice and works out which shipment or vendor PO it belongs to. */
export class ShipmentDocumentReader {
  constructor(
    private readonly repository: DocumentReaderRepository,
    private readonly generateJson: GenerateJsonFn,
    private readonly extractText: ExtractTextFn,
  ) {}

  async read(
    projectId: string,
    buffer: Buffer,
    mimeType: string,
    requestedKind: ReadableDocumentKind | undefined,
    businessId: string,
  ): Promise<ReadDocumentResultDto> {
    const project = await this.repository.findProject(projectId, businessId);
    if (!project) throw new NotFoundError("Project not found");
    const warnings: string[] = [];
    const result = (
      kind: ReadableDocumentKind | null,
      reader: ReadDocumentResultDto["reader"],
      fields: DocumentFields,
    ): ReadDocumentResultDto => ({
      kind,
      reader,
      ...fields,
      clientPurchaseOrderId: null,
      shipmentIds: [],
      purchaseOrder: null,
      warnings,
    });

    const text = await this.extractText(buffer, mimeType);
    if (!text) {
      warnings.push("No text could be read from the file. A scanned image needs to be typed in by hand.");
      return result(requestedKind ?? null, null, EMPTY_FIELDS);
    }
    const kind = requestedKind ?? detectDocumentKind(text);
    if (!kind) {
      warnings.push("This does not look like an e-way bill, GRN or invoice.");
      return result(null, null, EMPTY_FIELDS);
    }

    let fields: DocumentFields | null = null;
    let reader: ReadDocumentResultDto["reader"] = "AI";
    if (isSailIiscoDocument(text)) {
      fields = readIiscoDocument(kind, text);
      if (fields) reader = "IISCO";
      else warnings.push(`No SAIL IISCO ${KIND_NAME[kind]} reader is set up yet, so the AI model read it. Check the fields.`);
    }
    if (!fields) {
      const parsed = fieldsSchema.safeParse(await this.generateJson(fieldsPrompt(kind, text)));
      if (!parsed.success) {
        warnings.push("The model's response did not match the expected format. Fill the fields by hand.");
        return result(kind, reader, EMPTY_FIELDS);
      }
      const data = parsed.data;
      fields = {
        documentNumber: data.documentNumber?.trim() || null,
        documentDate: data.documentDate && ISO_DATE.test(data.documentDate) ? data.documentDate : null,
        poNumber: data.poNumber?.trim() || null,
        vehicleNumber: kind === "EWAY_BILL" ? data.vehicleNumber?.trim() || null : null,
        transporterName: kind === "EWAY_BILL" ? data.transporterName?.trim() || null : null,
        amount: kind === "VENDOR_INVOICE" ? (data.amount ?? null) : null,
      };
    }

    const dto = result(kind, reader, fields);
    if (kind === "VENDOR_INVOICE") {
      const orders = await this.repository.findVendorPurchaseOrders(project.tenderId, businessId);
      const order = orders.find((candidate) => sameReference(candidate.poNumber, fields.poNumber));
      if (!order) {
        warnings.push(
          fields.poNumber
            ? `PO ${fields.poNumber} on the invoice is not one of this project's vendor POs.`
            : "The invoice does not quote a PO number. Find the vendor PO by hand.",
        );
        return dto;
      }
      dto.purchaseOrder = { id: order.id, poNumber: order.poNumber, vendorName: order.vendorName, total: round2(order.total) };
      if (fields.amount !== null && Math.abs(fields.amount - order.total) > 1) {
        warnings.push(
          `The invoice total (${fields.amount}) differs from the PO total (${round2(order.total)}). It may include GST or freight; otherwise check it.`,
        );
      }
      return dto;
    }

    const [clientOrders, shipments] = await Promise.all([
      this.repository.findClientPurchaseOrders(projectId, businessId),
      this.repository.findManyByProject(projectId, businessId),
    ]);
    const clientOrder = clientOrders.find((candidate) => sameReference(candidate.poNumber, fields.poNumber));
    dto.clientPurchaseOrderId = clientOrder?.id ?? null;
    if (fields.poNumber && !clientOrder) {
      warnings.push(`PO ${fields.poNumber} on the document is not one of this project's client POs.`);
    }

    const recorded = shipments.find((shipment) =>
      sameReference(kind === "EWAY_BILL" ? shipment.ewayBillNumber : shipment.grnNumber, fields.documentNumber),
    );
    if (recorded) {
      warnings.push(`This ${KIND_NAME[kind]} is already recorded on shipment ${recorded.number}.`);
      return dto;
    }
    const waitingStage = kind === "EWAY_BILL" ? "PREPARING" : "DISPATCHED";
    dto.shipmentIds = shipments
      .filter((shipment) => shipmentStage(shipment) === waitingStage)
      .filter((shipment) => !clientOrder || shipment.clientPurchaseOrderId === clientOrder.id)
      .map((shipment) => shipment.id);
    if (dto.shipmentIds.length === 0) {
      warnings.push(
        kind === "EWAY_BILL"
          ? "No shipment is waiting to be dispatched. Start a shipment first."
          : "No dispatched shipment is waiting for a GRN.",
      );
    } else if (dto.shipmentIds.length > 1) {
      warnings.push(`${dto.shipmentIds.length} shipments could take this ${KIND_NAME[kind]}. Pick the right one.`);
    }
    return dto;
  }
}
