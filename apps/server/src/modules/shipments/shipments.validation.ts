import { PAYMENT_METHODS, SHIPMENT_DOCUMENT_TYPES } from "@bmp/types";
import { z } from "zod";

const dateSchema = z.string().datetime().or(z.string().date());

const itemsSchema = z
  .array(z.object({ clientPoItemId: z.string().uuid(), quantity: z.number().positive() }))
  .min(1, "Pick at least one item to ship");

export const createShipmentSchema = z.object({
  clientPurchaseOrderId: z.string().uuid(),
  items: itemsSchema,
  notes: z.string().max(2000).nullish(),
});

export const updateShipmentSchema = z.object({
  items: itemsSchema.optional(),
  notes: z.string().max(2000).nullish(),
  vehicleNumber: z.string().max(50).nullish(),
  transporterName: z.string().max(200).nullish(),
  freightCost: z.number().nonnegative().nullish(),
});

export const dispatchShipmentSchema = z.object({
  ewayBillNumber: z.string().trim().min(1).max(50),
  ewayBillDate: dateSchema,
  dispatchedAt: dateSchema.optional(),
  vehicleNumber: z.string().max(50).nullish(),
  transporterName: z.string().max(200).nullish(),
  freightCost: z.number().nonnegative().nullish(),
});

export const recordShipmentGrnSchema = z.object({
  grnNumber: z.string().trim().min(1).max(100),
  grnDate: dateSchema,
});

export const recordShipmentPaymentSchema = z.object({
  amount: z.number().positive(),
  method: z.enum(PAYMENT_METHODS),
  bankAccountId: z.string().uuid().optional(),
  referenceNumber: z.string().max(100).optional(),
  paymentDate: dateSchema.optional(),
  remarks: z.string().max(1000).optional(),
  settled: z.boolean(),
});

export const uploadShipmentDocumentSchema = z.object({
  documentType: z.enum(SHIPMENT_DOCUMENT_TYPES),
});
