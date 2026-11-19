"use client";

import {
  type ClientPurchaseOrderDto,
  SHIPMENT_STAGES,
  type ProjectSupplyDto,
  type ShipmentDto,
  type ShipmentStage,
  type SupplyLineDto,
} from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  confirmAction,
  EmptyState,
  formatDate,
  formatMoney,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bmp/ui";
import { FileSearch, FileText, Paperclip, Plus, Trash2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RecordPaymentDialog } from "@/components/finance/record-payment-dialog";
import {
  AttachDocumentDialog,
  DispatchDialog,
  type DocumentPrefill,
  DOCUMENT_TYPE_LABELS,
  GrnDialog,
  NewShipmentDialog,
  ReadDocumentDialog,
} from "@/components/projects/shipment-dialogs";
import {
  useBillShipment,
  useDeleteShipment,
  useRecordShipmentPayment,
  useUndoShipmentStage,
} from "@/hooks/use-shipments";

const STAGE_LABELS: Record<ShipmentStage, string> = {
  PREPARING: "Preparing",
  DISPATCHED: "Dispatched",
  GRN_RECEIVED: "GRN received",
  BILLED: "Billed",
  PAID: "Paid",
};

const UNDO_LABELS: Partial<Record<ShipmentStage, string>> = {
  DISPATCHED: "Undo dispatch",
  GRN_RECEIVED: "Undo GRN",
  PAID: "Reopen payment",
};

export interface SupplyPermissions {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canBill: boolean;
  canPay: boolean;
}

function ProgressCell({ value, of }: { value: number; of: number }) {
  const percent = of > 0 ? Math.min(100, Math.round((value / of) * 100)) : 0;
  return (
    <div className="min-w-24 space-y-1 text-right tabular-nums">
      <span>{value}</span>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full bg-success" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function ItemProgressTable({ lines }: { lines: SupplyLineDto[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Item</TableHead>
          <TableHead className="text-right">Ordered by client</TableHead>
          <TableHead className="text-right">Bought</TableHead>
          <TableHead className="text-right">Received</TableHead>
          <TableHead className="text-right">Dispatched</TableHead>
          <TableHead className="text-right">GRN accepted</TableHead>
          <TableHead>Vendor POs</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={line.key}>
            <TableCell className="max-w-sm">
              <p>{line.description}</p>
              {line.itemCode && <p className="text-xs text-muted-foreground">{line.itemCode}</p>}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {line.ordered} {line.unit ?? ""}
            </TableCell>
            <TableCell>
              <ProgressCell value={line.procured} of={line.ordered} />
            </TableCell>
            <TableCell>
              <ProgressCell value={line.received} of={line.ordered} />
            </TableCell>
            <TableCell>
              <ProgressCell value={line.dispatched} of={line.ordered} />
            </TableCell>
            <TableCell>
              <ProgressCell value={line.accepted} of={line.ordered} />
            </TableCell>
            <TableCell className="text-sm">
              {line.vendorPurchaseOrders.length === 0 ? (
                <span className="text-muted-foreground">{line.boqItemId ? "None yet" : "Not in our BOQ"}</span>
              ) : (
                <div className="space-y-1">
                  {line.vendorPurchaseOrders.map((po) => (
                    <Link key={po.purchaseOrderId} href={`/purchase-orders/${po.purchaseOrderId}`} className="block hover:underline">
                      {po.poNumber} · {po.vendorName} · {po.receivedQuantity}/{po.quantity}
                    </Link>
                  ))}
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ShipmentCard({
  projectId,
  shipment,
  permissions,
  onOpen,
}: {
  projectId: string;
  shipment: ShipmentDto;
  permissions: SupplyPermissions;
  onOpen: (dialog: "dispatch" | "grn" | "attach", shipment: ShipmentDto) => void;
}) {
  const { toast } = useToast();
  const bill = useBillShipment(projectId);
  const pay = useRecordShipmentPayment(projectId);
  const undo = useUndoShipmentStage(projectId);
  const remove = useDeleteShipment(projectId);
  const undoLabel = UNDO_LABELS[shipment.stage];

  async function run(action: () => Promise<unknown>, success: string, failure: string) {
    try {
      await action();
      toast({ title: success });
    } catch (error) {
      toast({ variant: "destructive", title: failure, description: error instanceof Error ? error.message : "Please try again." });
    }
  }

  async function raiseBill() {
    const confirmed = await confirmAction({
      title: `Raise the bill for shipment ${shipment.number}?`,
      description: `${formatMoney(shipment.value)} at the client PO rates, quoting GRN ${shipment.grnNumber}.`,
      confirmLabel: "Raise bill",
      destructive: false,
    });
    if (confirmed) await run(() => bill.mutateAsync(shipment.id), "Bill raised", "Could not raise the bill");
  }

  async function deleteShipment() {
    const confirmed = await confirmAction({
      title: `Delete shipment ${shipment.number}?`,
      description: "Its items go back to “left to ship” and its documents are removed.",
      confirmLabel: "Delete shipment",
    });
    if (confirmed) await run(() => remove.mutateAsync(shipment.id), "Shipment deleted", "Could not delete the shipment");
  }

  return (
    <Card className="text-sm">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">Shipment {shipment.number}</p>
            <p className="text-xs text-muted-foreground">
              PO {shipment.clientPoNumber} · {formatMoney(shipment.value)}
            </p>
          </div>
          {permissions.canUpdate && (
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Attach document" onClick={() => onOpen("attach", shipment)}>
              <Paperclip className="h-4 w-4" />
            </Button>
          )}
        </div>
        <ul className="space-y-0.5 text-xs">
          {shipment.items.map((item) => (
            <li key={item.id} className="truncate">
              {item.quantity} {item.unit ?? ""} · {item.description}
            </li>
          ))}
        </ul>
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {shipment.ewayBillNumber && shipment.dispatchedAt && (
            <p>
              E-way bill {shipment.ewayBillNumber} · sent {formatDate(shipment.dispatchedAt)}
            </p>
          )}
          {shipment.grnNumber && shipment.grnDate && (
            <p>
              GRN {shipment.grnNumber} · {formatDate(shipment.grnDate)}
            </p>
          )}
          {shipment.bill && (
            <p>
              <Link href={`/bills/${shipment.bill.id}`} className="hover:underline">
                Bill {shipment.bill.billNumber}
              </Link>{" "}
              · {formatMoney(shipment.bill.total)}
            </p>
          )}
          {shipment.amountReceived > 0 && <p>Received {formatMoney(shipment.amountReceived)}</p>}
        </div>
        {shipment.documents.length > 0 && (
          <div className="space-y-0.5 text-xs">
            {shipment.documents.map((doc) => (
              <a key={doc.id} href={doc.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 truncate hover:underline">
                <FileText className="h-3 w-3 shrink-0" aria-hidden="true" />
                {doc.documentType ? `${DOCUMENT_TYPE_LABELS[doc.documentType as keyof typeof DOCUMENT_TYPE_LABELS] ?? doc.documentType}: ` : ""}
                {doc.originalName}
              </a>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-1 pt-1">
          {permissions.canDelete && (shipment.stage === "PREPARING" || shipment.stage === "DISPATCHED") && (
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Delete shipment" onClick={() => void deleteShipment()}>
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          {permissions.canUpdate && undoLabel && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={undoLabel}
              disabled={undo.isPending}
              onClick={() => void run(() => undo.mutateAsync(shipment.id), "Stepped back", "Could not step back")}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          )}
          {permissions.canUpdate && shipment.stage === "PREPARING" && (
            <Button size="sm" onClick={() => onOpen("dispatch", shipment)}>
              Mark dispatched
            </Button>
          )}
          {permissions.canUpdate && shipment.stage === "DISPATCHED" && (
            <Button size="sm" onClick={() => onOpen("grn", shipment)}>
              Record GRN
            </Button>
          )}
          {permissions.canBill && shipment.stage === "GRN_RECEIVED" && (
            <Button size="sm" onClick={() => void raiseBill()} disabled={bill.isPending}>
              {bill.isPending ? "Raising…" : "Raise bill"}
            </Button>
          )}
          {permissions.canPay && shipment.stage === "BILLED" && shipment.bill && (
            <RecordPaymentDialog
              remainingAmount={Math.max(0, shipment.bill.total - shipment.amountReceived)}
              isSubmitting={pay.isPending}
              closeOption="Payment complete for this shipment"
              onSubmit={async ({ close, ...input }) => {
                await pay.mutateAsync({ id: shipment.id, input: { ...input, settled: close ?? false } });
                toast({ title: close ? "Shipment paid" : "Payment recorded" });
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function SupplyTab({
  projectId,
  supply,
  orders,
  permissions,
}: {
  projectId: string;
  supply: ProjectSupplyDto | undefined;
  orders: ClientPurchaseOrderDto[];
  permissions: SupplyPermissions;
}) {
  const [creating, setCreating] = useState(false);
  const [reading, setReading] = useState(false);
  const [dialog, setDialog] = useState<{
    kind: "dispatch" | "grn" | "attach";
    shipment: ShipmentDto;
    prefill?: DocumentPrefill;
  } | null>(null);
  const shipments = supply?.shipments ?? [];
  const onOpen = (kind: "dispatch" | "grn" | "attach", shipment: ShipmentDto) => setDialog({ kind, shipment });
  const closeDialog = (open: boolean) => !open && setDialog(null);

  if (orders.length === 0) {
    return (
      <EmptyState
        title="No client PO yet"
        description="Record the client's PO first; supply is tracked against the items it orders."
      />
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
          <p className="text-sm text-muted-foreground">
            Receive goods on the vendor PO; vendor PO lines count here when they name the BOQ line.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <ItemProgressTable lines={supply?.lines ?? []} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Shipments</h2>
        <div className="flex flex-wrap justify-end gap-2">
          {permissions.canUpdate && (
            <Button variant="outline" onClick={() => setReading(true)}>
              <FileSearch className="mr-2 h-4 w-4" /> Read a document
            </Button>
          )}
          {permissions.canCreate && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="mr-2 h-4 w-4" /> New shipment
            </Button>
          )}
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        {SHIPMENT_STAGES.map((stage) => {
          const column = shipments.filter((shipment) => shipment.stage === stage);
          return (
            <section key={stage} aria-label={STAGE_LABELS[stage]} className="space-y-2 rounded-lg bg-muted/50 p-2">
              <h3 className="flex items-center justify-between px-1 text-sm font-medium">
                {STAGE_LABELS[stage]}
                <span className="text-xs tabular-nums text-muted-foreground">{column.length}</span>
              </h3>
              {column.map((shipment) => (
                <ShipmentCard key={shipment.id} projectId={projectId} shipment={shipment} permissions={permissions} onOpen={onOpen} />
              ))}
            </section>
          );
        })}
      </div>

      {creating && (
        <NewShipmentDialog projectId={projectId} orders={orders} shipments={shipments} open onOpenChange={setCreating} />
      )}
      {reading && (
        <ReadDocumentDialog
          projectId={projectId}
          shipments={shipments}
          open
          onOpenChange={setReading}
          onUse={(kind, shipment, prefill) => {
            setReading(false);
            setDialog({ kind, shipment, prefill });
          }}
        />
      )}
      {dialog?.kind === "dispatch" && (
        <DispatchDialog projectId={projectId} shipment={dialog.shipment} prefill={dialog.prefill} open onOpenChange={closeDialog} />
      )}
      {dialog?.kind === "grn" && (
        <GrnDialog projectId={projectId} shipment={dialog.shipment} prefill={dialog.prefill} open onOpenChange={closeDialog} />
      )}
      {dialog?.kind === "attach" && (
        <AttachDocumentDialog projectId={projectId} shipment={dialog.shipment} open onOpenChange={closeDialog} />
      )}
    </div>
  );
}
