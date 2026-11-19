import type { ShipmentStage, SupplyLineDto, SupplyVendorPoLineDto } from "@bmp/types";

import { round2 } from "../../shared/utils/math.js";

export function shipmentStage(shipment: {
  dispatchedAt: Date | null;
  grnNumber: string | null;
  billId: string | null;
  settledAt: Date | null;
}): ShipmentStage {
  if (shipment.settledAt) return "PAID";
  if (shipment.billId) return "BILLED";
  if (shipment.grnNumber) return "GRN_RECEIVED";
  if (shipment.dispatchedAt) return "DISPATCHED";
  return "PREPARING";
}

export interface ClientPoLine {
  id: string;
  boqItemId: string | null;
  itemCode: string | null;
  description: string;
  unit: string | null;
  quantity: number;
}

export interface VendorPoLine extends SupplyVendorPoLineDto {
  boqItemId: string | null;
}

export interface ShippedLine {
  clientPoItemId: string;
  quantity: number;
  dispatched: boolean;
  accepted: boolean;
}

/**
 * Follows each ordered thing through procurement and shipping. Client PO lines are grouped by
 * BOQ line (split POs add up) and joined to vendor PO lines on the same BOQ line; a client line
 * without a BOQ link is its own row with nothing procured against it.
 */
export function buildSupplyLines(
  clientLines: ClientPoLine[],
  vendorLines: VendorPoLine[],
  shipped: ShippedLine[],
): SupplyLineDto[] {
  const rows = new Map<string, SupplyLineDto>();
  const rowKeyByClientLine = new Map<string, string>();

  for (const line of clientLines) {
    const key = line.boqItemId ?? `line:${line.id}`;
    rowKeyByClientLine.set(line.id, key);
    const row = rows.get(key);
    if (row) {
      row.ordered = round2(row.ordered + line.quantity);
      continue;
    }
    const vendorPurchaseOrders = line.boqItemId
      ? vendorLines
          .filter((vendor) => vendor.boqItemId === line.boqItemId)
          .map(({ boqItemId: _boqItemId, ...vendor }) => vendor)
      : [];
    const active = vendorPurchaseOrders.filter((vendor) => vendor.status !== "CANCELLED");
    rows.set(key, {
      key,
      boqItemId: line.boqItemId,
      itemCode: line.itemCode,
      description: line.description,
      unit: line.unit,
      ordered: line.quantity,
      procured: round2(active.reduce((sum, vendor) => sum + vendor.quantity, 0)),
      received: round2(active.reduce((sum, vendor) => sum + vendor.receivedQuantity, 0)),
      dispatched: 0,
      accepted: 0,
      vendorPurchaseOrders,
    });
  }

  for (const item of shipped) {
    const row = rows.get(rowKeyByClientLine.get(item.clientPoItemId) ?? "");
    if (!row) continue;
    if (item.dispatched) row.dispatched = round2(row.dispatched + item.quantity);
    if (item.accepted) row.accepted = round2(row.accepted + item.quantity);
  }
  return [...rows.values()];
}

/**
 * Checks a shipment's requested quantities against what the client ordered, net of what other
 * shipments already carry. Returns the first problem in words, or null.
 */
export function shipmentQuantityProblem(
  requested: { clientPoItemId: string; quantity: number }[],
  orderedById: Map<string, { description: string; quantity: number }>,
  shippedElsewhereById: Map<string, number>,
): string | null {
  if (requested.length === 0) return "Pick at least one item to ship";
  const seen = new Set<string>();
  for (const item of requested) {
    const line = orderedById.get(item.clientPoItemId);
    if (!line) return "An item is not on this client PO";
    if (seen.has(item.clientPoItemId)) return `"${line.description}" is listed twice`;
    seen.add(item.clientPoItemId);
    const remaining = round2(line.quantity - (shippedElsewhereById.get(item.clientPoItemId) ?? 0));
    if (item.quantity > remaining + 0.005) {
      return `"${line.description}": only ${remaining} left to ship of the ${line.quantity} ordered`;
    }
  }
  return null;
}
