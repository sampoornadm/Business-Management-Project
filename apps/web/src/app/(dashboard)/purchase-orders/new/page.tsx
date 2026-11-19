"use client";

import type { CreatePurchaseOrderItemInput } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormActions,
  formatMoney,
  Input,
  PageHeader,
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
import { useMemo, useState } from "react";

import { useCurrentBoq } from "@/hooks/use-boq";
import { useCreatePurchaseOrder } from "@/hooks/use-purchase-orders";
import { useTenders } from "@/hooks/use-tenders";
import { useVendors } from "@/hooks/use-vendors";

const NO_BOQ_LINE = "__none__";

interface DraftItem {
  /** The tender BOQ line this buys; lets the project's supply view count it. */
  boqItemId: string;
  description: string;
  unit: string;
  quantity: string;
  rate: string;
}

function emptyItem(): DraftItem {
  return { boqItemId: NO_BOQ_LINE, description: "", unit: "", quantity: "", rate: "" };
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
  const boqQuery = useCurrentBoq(tenderId || undefined);
  // Only leaf lines are orderable; a parent heading is not.
  const boqLines = useMemo(() => {
    const all = boqQuery.data?.items ?? [];
    const parents = new Set(all.map((item) => item.parentId).filter(Boolean));
    return all.filter((item) => !parents.has(item.id));
  }, [boqQuery.data]);

  function pickBoqLine(index: number, boqItemId: string) {
    const line = boqLines.find((candidate) => candidate.id === boqItemId);
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              ...item,
              boqItemId,
              description: item.description || line?.description || "",
              unit: item.unit || line?.unit || "",
              quantity: item.quantity || (line?.quantity != null ? String(line.quantity) : ""),
            }
          : item,
      ),
    );
  }

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
        boqItemId: tenderId && item.boqItemId !== NO_BOQ_LINE ? item.boqItemId : null,
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
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Create purchase order"
        description="Place a direct order with a vendor."
      />

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
              <Select
                value={tenderId || "__none__"}
                onValueChange={(v) => {
                  setTenderId(v === "__none__" ? "" : v);
                  setItems((prev) => prev.map((item) => ({ ...item, boqItemId: NO_BOQ_LINE })));
                }}
              >
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
                {tenderId && <TableHead className="min-w-48">BOQ line</TableHead>}
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
                  {tenderId && (
                    <TableCell>
                      <Select value={item.boqItemId} onValueChange={(value) => pickBoqLine(index, value)}>
                        <SelectTrigger aria-label="BOQ line">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_BOQ_LINE}>Not a BOQ line</SelectItem>
                          {boqLines.map((line) => (
                            <SelectItem key={line.id} value={line.id}>
                              {line.description.slice(0, 70)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  )}
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
                      money
                      value={item.rate}
                      onChange={(e) => updateItem(index, { rate: e.target.value })}
                    />
                  </TableCell>
                  <TableCell>
                    {items.length > 1 && (
                      <Button size="sm" variant="ghost" aria-label="Remove item" onClick={() => removeItem(index)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-3 text-right text-sm font-medium">Total: {formatMoney(total)}</p>
        </CardContent>
      </Card>

      <FormActions onCancel={() => window.history.back()}>
        <Button onClick={handleSubmit} disabled={createPo.isPending}>
          {createPo.isPending ? "Creating…" : "Create purchase order"}
        </Button>
      </FormActions>
    </div>
  );
}
