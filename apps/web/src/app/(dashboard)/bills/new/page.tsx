"use client";

import type { BoqItemDto, CreateBillItemInput } from "@bmp/types";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@bmp/ui";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { useCreateBill } from "@/hooks/use-bills";
import { useCurrentBoq } from "@/hooks/use-boq";
import { useTender } from "@/hooks/use-tenders";

function flattenBoqItems(items: BoqItemDto[]): BoqItemDto[] {
  return items.flatMap((item) => [item, ...flattenBoqItems(item.children)]);
}

interface DraftLine {
  quantity: string;
  rate: string;
}

export default function NewBillPage() {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const tenderId = searchParams.get("tenderId") ?? "";

  const tenderQuery = useTender(tenderId || undefined);
  const boqQuery = useCurrentBoq(tenderId || undefined);
  const createBill = useCreateBill();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [lines, setLines] = useState<Record<string, DraftLine>>({});
  const [grnNumber, setGrnNumber] = useState("");
  const [grnDate, setGrnDate] = useState("");

  const boqItems = boqQuery.data ? flattenBoqItems(boqQuery.data.items) : [];

  function toggleItem(item: BoqItemDto, checked: boolean) {
    setSelectedIds((prev) => (checked ? [...prev, item.id] : prev.filter((id) => id !== item.id)));
    if (checked && !lines[item.id]) {
      setLines((prev) => ({
        ...prev,
        [item.id]: { quantity: String(item.quantity ?? 0), rate: String(item.rate ?? 0) },
      }));
    }
  }

  function updateLine(itemId: string, patch: Partial<DraftLine>) {
    setLines((prev) => ({ ...prev, [itemId]: { ...prev[itemId]!, ...patch } }));
  }

  async function handleSubmit() {
    if (!tenderId) {
      toast({ variant: "destructive", title: "No tender selected" });
      return;
    }
    const items: CreateBillItemInput[] = boqItems
      .filter((item) => selectedIds.includes(item.id))
      .map((item) => ({
        boqItemId: item.id,
        description: item.description,
        unit: item.unit ?? undefined,
        quantity: Number(lines[item.id]!.quantity),
        rate: Number(lines[item.id]!.rate),
      }));

    if (items.length === 0) {
      toast({ variant: "destructive", title: "Select at least one item" });
      return;
    }

    try {
      const bill = await createBill.mutateAsync({
        tenderId,
        grnNumber: grnNumber.trim() || undefined,
        grnDate: grnDate || undefined,
        items,
      });
      toast({ title: "Bill created" });
      router.push(`/bills/${bill.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create bill",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create Bill</h1>
        <p className="text-sm text-muted-foreground">
          {tenderQuery.data ? `Against ${tenderQuery.data.tenderNumber} — ${tenderQuery.data.title}` : "Select the items being billed."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">GRN reference</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">GRN number (optional)</label>
            <Input value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} placeholder="GRN-2201" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">GRN date (optional)</label>
            <Input type="date" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Description</TableHead>
                <TableHead className="w-24">Unit</TableHead>
                <TableHead className="w-28">BOQ Qty</TableHead>
                <TableHead className="w-32">Billed Qty</TableHead>
                <TableHead className="w-32">Rate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {boqItems.map((item) => {
                const checked = selectedIds.includes(item.id);
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleItem(item, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell className="max-w-md text-sm">{item.description}</TableCell>
                    <TableCell>{item.unit ?? "-"}</TableCell>
                    <TableCell>{item.quantity ?? "-"}</TableCell>
                    <TableCell>
                      {checked && (
                        <Input
                          type="number"
                          value={lines[item.id]?.quantity ?? ""}
                          onChange={(e) => updateLine(item.id, { quantity: e.target.value })}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {checked && (
                        <Input
                          type="number"
                          value={lines[item.id]?.rate ?? ""}
                          onChange={(e) => updateLine(item.id, { rate: e.target.value })}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Button onClick={handleSubmit} disabled={createBill.isPending}>
        {createBill.isPending ? "Creating…" : "Create Bill"}
      </Button>
    </div>
  );
}
