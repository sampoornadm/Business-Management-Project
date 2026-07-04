"use client";

import type { PurchaseOrderItemDto } from "@bmp/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useToast,
} from "@bmp/ui";
import { PackageCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { useCreateGoodsReceipt } from "@/hooks/use-purchase-orders";

export function GoodsReceiptDialog({
  purchaseOrderId,
  items,
}: {
  purchaseOrderId: string;
  items: PurchaseOrderItemDto[];
}) {
  const { toast } = useToast();
  const createGoodsReceipt = useCreateGoodsReceipt(purchaseOrderId);
  const [open, setOpen] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");

  const pendingItems = items.filter((item) => item.receivedQuantity < item.quantity);

  useEffect(() => {
    if (open) {
      setQuantities({});
      setRemarks("");
    }
  }, [open]);

  async function handleSubmit() {
    const receiptItems = pendingItems
      .map((item) => ({ purchaseOrderItemId: item.id, quantityReceived: Number(quantities[item.id] ?? "") }))
      .filter((entry) => entry.quantityReceived > 0);

    if (receiptItems.length === 0) {
      toast({ variant: "destructive", title: "Enter a received quantity for at least one item" });
      return;
    }

    try {
      await createGoodsReceipt.mutateAsync({ remarks: remarks || undefined, items: receiptItems });
      toast({ title: "Goods receipt recorded" });
      setOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not record goods receipt",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PackageCheck className="mr-2 h-4 w-4" /> Record goods receipt
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Record goods receipt</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Pending</TableHead>
                <TableHead className="w-28">Receiving now</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right">
                    {item.quantity - item.receivedQuantity} {item.unit ?? ""}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={quantities[item.id] ?? ""}
                      onChange={(e) => setQuantities((prev) => ({ ...prev, [item.id]: e.target.value }))}
                      max={item.quantity - item.receivedQuantity}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Textarea
            rows={2}
            placeholder="Remarks (optional)"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={createGoodsReceipt.isPending}>
            {createGoodsReceipt.isPending ? "Recording…" : "Record receipt"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
