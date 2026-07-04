"use client";

import type { CreatePurchaseOrderItemInput } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  useToast,
} from "@bmp/ui";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCreatePurchaseOrder } from "@/hooks/use-purchase-orders";
import { useTenders } from "@/hooks/use-tenders";
import { useVendors } from "@/hooks/use-vendors";

interface DraftItem {
  description: string;
  unit: string;
  quantity: string;
  rate: string;
}

function emptyItem(): DraftItem {
  return { description: "", unit: "", quantity: "", rate: "" };
}

export default function NewPurchaseOrderPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createPo = useCreatePurchaseOrder();
  const vendorsQuery = useVendors({ page: 1, pageSize: 100, isActive: true });
  const tendersQuery = useTenders({ page: 1, pageSize: 100 });

  const [vendorId, setVendorId] = useState("");
  const [tenderId, setTenderId] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const total = items.reduce((sum, item) => {
    const qty = Number(item.quantity);
    const rate = Number(item.rate);
    return sum + (Number.isFinite(qty) && Number.isFinite(rate) ? qty * rate : 0);
  }, 0);

  async function handleSubmit() {
    if (!vendorId) {
      toast({ variant: "destructive", title: "Select a vendor" });
      return;
    }
    const preparedItems: CreatePurchaseOrderItemInput[] = items
      .filter((item) => item.description.trim() && item.quantity.trim() && item.rate.trim())
      .map((item) => ({
        description: item.description.trim(),
        unit: item.unit.trim() || undefined,
        quantity: Number(item.quantity),
        rate: Number(item.rate),
      }));
    if (preparedItems.length === 0) {
      toast({ variant: "destructive", title: "Add at least one item" });
      return;
    }

    try {
      const po = await createPo.mutateAsync({
        vendorId,
        tenderId: tenderId || undefined,
        expectedDeliveryDate: expectedDeliveryDate || undefined,
        notes: notes || undefined,
        items: preparedItems,
      });
      toast({ title: "Purchase order created" });
      router.push(`/purchase-orders/${po.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create purchase order",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create Purchase Order</h1>
        <p className="text-sm text-muted-foreground">Place a direct order with a vendor.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Vendor</label>
              <Select value={vendorId} onValueChange={setVendorId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a vendor" />
                </SelectTrigger>
                <SelectContent>
                  {(vendorsQuery.data?.items ?? []).map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Tender (optional)</label>
              <Select value={tenderId || "__none__"} onValueChange={(v) => setTenderId(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Not linked to a tender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not linked to a tender</SelectItem>
                  {(tendersQuery.data?.items ?? []).map((tender) => (
                    <SelectItem key={tender.id} value={tender.id}>
                      {tender.tenderNumber} — {tender.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Expected delivery date (optional)</label>
            <Input
              type="date"
              value={expectedDeliveryDate}
              onChange={(e) => setExpectedDeliveryDate(e.target.value)}
              className="max-w-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Notes</label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Items</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
            <Plus className="mr-2 h-4 w-4" /> Add item
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="w-28">Unit</TableHead>
                <TableHead className="w-28">Quantity</TableHead>
                <TableHead className="w-28">Rate</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Input
                      value={item.description}
                      onChange={(e) => updateItem(index, { description: e.target.value })}
                      placeholder="OPC Cement"
                    />
                  </TableCell>
                  <TableCell>
                    <Input value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })} placeholder="bag" />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      value={item.rate}
                      onChange={(e) => updateItem(index, { rate: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    {items.length > 1 && (
                      <Button size="sm" variant="ghost" onClick={() => removeItem(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-right text-sm font-medium">Total: {total.toLocaleString()}</p>
        </CardContent>
      </Card>

      <Button onClick={handleSubmit} disabled={createPo.isPending}>
        {createPo.isPending ? "Creating…" : "Create Purchase Order"}
      </Button>
    </div>
  );
}
