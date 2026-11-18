"use client";

import type { ClientPoItemFlag, ClientPurchaseOrderDto, ProjectClientPurchaseOrdersDto } from "@bmp/types";
import {
  Badge,
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
import { FileText, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { ClientPurchaseOrderDialog } from "@/components/projects/client-purchase-order-dialog";
import { useDeleteClientPurchaseOrder } from "@/hooks/use-client-purchase-orders";

const FLAG_LABELS: Record<ClientPoItemFlag, string> = {
  NOT_IN_BOQ: "Not in our BOQ",
  RATE_MISMATCH: "Rate differs from our quote",
  QTY_ABOVE_BOQ: "More than BOQ quantity",
  UNIT_MISMATCH: "Unit differs from BOQ",
};

interface ClientPurchaseOrdersTabProps {
  projectId: string;
  tenderId: string;
  deliveryPeriodDays: number;
  data: ProjectClientPurchaseOrdersDto | undefined;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
}

function OrderCard({
  order,
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
}: {
  order: ClientPurchaseOrderDto;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const flagged = order.items.filter((item) => item.flags.length > 0).length;
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">PO {order.poNumber}</CardTitle>
          <p className="text-sm text-muted-foreground">
            Dated {formatDate(order.poDate)} · Delivery due {formatDate(order.deliveryDueDate)} · {formatMoney(order.poValue)}
          </p>
          {order.documents.length > 0 && (
            <div className="flex flex-wrap gap-3 text-sm">
              {order.documents.map((doc) => (
                <a key={doc.id} href={doc.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  {doc.originalName}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {flagged > 0 && <Badge variant="destructive">{flagged} line{flagged === 1 ? "" : "s"} to check</Badge>}
          {canDelete && (
            <Button size="sm" variant="destructiveOutline" onClick={onDelete}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete PO
            </Button>
          )}
          {canUpdate && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" /> Edit PO
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">PO rate</TableHead>
              <TableHead className="text-right">Our rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Check</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="max-w-md">
                  <p>{item.description}</p>
                  {item.itemCode && <p className="text-xs text-muted-foreground">{item.itemCode}</p>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.quantity} {item.unit ?? ""}
                  {item.boqQuantity !== null && (
                    <p className="text-xs text-muted-foreground">
                      BOQ {item.boqQuantity} {item.boqUnit ?? ""}
                    </p>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(item.rate)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {item.quotedRate !== null ? formatMoney(item.quotedRate) : "–"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(item.amount)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {item.flags.length === 0 ? (
                      <Badge variant="success">Matches</Badge>
                    ) : (
                      item.flags.map((flag) => (
                        <Badge key={flag} variant="destructive">
                          {FLAG_LABELS[flag]}
                        </Badge>
                      ))
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {order.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{order.notes}</p>}
      </CardContent>
    </Card>
  );
}

export function ClientPurchaseOrdersTab({
  projectId,
  tenderId,
  deliveryPeriodDays,
  data,
  canCreate,
  canUpdate,
  canDelete,
}: ClientPurchaseOrdersTabProps) {
  const { toast } = useToast();
  const deleteOrder = useDeleteClientPurchaseOrder(projectId);
  // undefined = closed, null = new PO, else the PO being edited.
  const [editing, setEditing] = useState<ClientPurchaseOrderDto | null | undefined>(undefined);
  const orders = data?.orders ?? [];
  const unordered = data?.unorderedBoqItems ?? [];

  async function handleDelete(order: ClientPurchaseOrderDto) {
    const confirmed = await confirmAction({
      title: `Delete client PO ${order.poNumber}?`,
      description: "Its lines and attached documents are removed.",
      confirmLabel: "Delete PO",
    });
    if (!confirmed) return;
    try {
      await deleteOrder.mutateAsync(order.id);
      toast({ title: "Client PO deleted" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete the client PO",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="space-y-4">
      {canCreate && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing(null)}>
            <Plus className="mr-2 h-4 w-4" /> Record client PO
          </Button>
        </div>
      )}

      {orders.length === 0 ? (
        <EmptyState
          title="No client PO yet"
          description="Upload the purchase order the client sent. It sets the delivery deadline and the items to supply."
        />
      ) : (
        orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            canUpdate={canUpdate}
            canDelete={canDelete}
            onEdit={() => setEditing(order)}
            onDelete={() => void handleDelete(order)}
          />
        ))
      )}

      {orders.length > 0 && unordered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">BOQ lines not ordered yet</CardTitle>
            <p className="text-sm text-muted-foreground">
              We quoted these lines, but no client PO orders them so far.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">BOQ quantity</TableHead>
                  <TableHead className="text-right">Our rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unordered.map((line) => (
                  <TableRow key={line.boqItemId}>
                    <TableCell className="max-w-md">{line.description}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.quantity ?? "–"} {line.unit ?? ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.rate !== null ? formatMoney(line.rate) : "–"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {editing !== undefined && (
        <ClientPurchaseOrderDialog
          key={editing?.id ?? "new"}
          projectId={projectId}
          tenderId={tenderId}
          deliveryPeriodDays={deliveryPeriodDays}
          unorderedBoqItems={unordered}
          order={editing ?? undefined}
          open
          onOpenChange={(open) => !open && setEditing(undefined)}
        />
      )}
    </div>
  );
}
