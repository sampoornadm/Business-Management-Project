"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bmp/ui";
import Link from "next/link";
import { useParams } from "next/navigation";

import { RecordPaymentDialog } from "@/components/finance/record-payment-dialog";
import { GoodsReceiptDialog } from "@/components/purchase-orders/goods-receipt-dialog";
import { VendorRatingWidget } from "@/components/purchase-orders/vendor-rating-widget";
import {
  usePurchaseOrder,
  usePurchaseOrderPayments,
  useRecordPurchaseOrderPayment,
  useUpdatePurchaseOrderStatus,
} from "@/hooks/use-purchase-orders";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  ISSUED: "secondary",
  PARTIALLY_RECEIVED: "secondary",
  RECEIVED: "default",
  CANCELLED: "destructive",
};

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canUpdate = hasPermission(roleName, "purchase_orders:update");
  const canReceive = hasPermission(roleName, "purchase_orders:receive");
  const canRecordPayment = hasPermission(roleName, "finance:create");

  const poQuery = usePurchaseOrder(params.id);
  const updateStatus = useUpdatePurchaseOrderStatus(params.id);
  const paymentsQuery = usePurchaseOrderPayments(params.id);
  const recordPayment = useRecordPurchaseOrderPayment(params.id);

  async function handleIssue() {
    try {
      await updateStatus.mutateAsync({ status: "ISSUED" });
      toast({ title: "Purchase order issued" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not issue purchase order",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleCancel() {
    try {
      await updateStatus.mutateAsync({ status: "CANCELLED" });
      toast({ title: "Purchase order cancelled" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not cancel purchase order",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (poQuery.isLoading || !poQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const po = poQuery.data;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{po.poNumber}</h1>
            <Badge variant={STATUS_VARIANT[po.status]}>{po.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            <Link href={`/vendors/${po.vendor.id}`} className="hover:underline">
              {po.vendor.name}
            </Link>
            {po.tenderId && (
              <>
                {" · "}
                <Link href={`/tenders/${po.tenderId}`} className="hover:underline">
                  View linked tender
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          {canUpdate && po.status === "DRAFT" && (
            <>
              <Button variant="outline" onClick={handleCancel} disabled={updateStatus.isPending}>
                Cancel
              </Button>
              <Button onClick={handleIssue} disabled={updateStatus.isPending}>
                Issue
              </Button>
            </>
          )}
          {canReceive && (po.status === "ISSUED" || po.status === "PARTIALLY_RECEIVED") && (
            <GoodsReceiptDialog purchaseOrderId={po.id} items={po.items} />
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Quantity</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.unit ?? "-"}</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{item.receivedQuantity}</TableCell>
                  <TableCell className="text-right">{item.rate.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{item.amount.toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-right text-sm font-medium">Total: {po.totalAmount.toLocaleString()}</p>
        </CardContent>
      </Card>

      {po.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{po.notes}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Goods receipts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {po.goodsReceipts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No goods received yet.</p>
          ) : (
            po.goodsReceipts.map((receipt) => (
              <div key={receipt.id} className="rounded-md border p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{new Date(receipt.receivedDate).toLocaleDateString()}</span>
                  <span className="text-muted-foreground">
                    by {receipt.receivedBy.firstName} {receipt.receivedBy.lastName}
                  </span>
                </div>
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {receipt.items.map((item) => {
                    const poItem = po.items.find((i) => i.id === item.purchaseOrderItemId);
                    return (
                      <li key={item.id}>
                        {poItem?.description ?? "Item"}: {item.quantityReceived} {poItem?.unit ?? ""}
                      </li>
                    );
                  })}
                </ul>
                {receipt.remarks && <p className="mt-1 italic">{receipt.remarks}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {canRecordPayment && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Payments to vendor</CardTitle>
            {(() => {
              const paid = (paymentsQuery.data ?? []).reduce((sum, p) => sum + p.amount, 0);
              const remaining = po.totalAmount - paid;
              return (
                remaining > 0 && (
                  <RecordPaymentDialog
                    remainingAmount={remaining}
                    isSubmitting={recordPayment.isPending}
                    onSubmit={async (input) => {
                      await recordPayment.mutateAsync(input);
                      toast({ title: "Payment recorded" });
                    }}
                  />
                )
              );
            })()}
          </CardHeader>
          <CardContent className="space-y-2">
            {(paymentsQuery.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
            ) : (
              paymentsQuery.data!.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <p className="font-medium">{payment.amount.toLocaleString()}</p>
                  <p className="text-muted-foreground">
                    {payment.method} · {new Date(payment.paymentDate).toLocaleDateString()}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {po.status === "RECEIVED" && canUpdate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rate this vendor</CardTitle>
          </CardHeader>
          <CardContent>
            <VendorRatingWidget purchaseOrderId={po.id} existingRating={po.vendorRating} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
