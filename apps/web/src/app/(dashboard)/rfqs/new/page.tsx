"use client";

import type { CreateRfqItemInput } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  MultiSelect,
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
  useToast,
} from "@bmp/ui";
import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCreateRfq } from "@/hooks/use-rfq";
import { useTenders } from "@/hooks/use-tenders";
import { useVendors } from "@/hooks/use-vendors";

interface DraftItem {
  description: string;
  unit: string;
  quantity: string;
}

function emptyItem(): DraftItem {
  return { description: "", unit: "", quantity: "" };
}

export default function NewRfqPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createRfq = useCreateRfq();
  const tendersQuery = useTenders({ page: 1, pageSize: 100 });
  const vendorsQuery = useVendors({ page: 1, pageSize: 100, isActive: true });

  const [title, setTitle] = useState("");
  const [tenderId, setTenderId] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [vendorIds, setVendorIds] = useState<string[]>([]);

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!title.trim()) {
      toast({ variant: "destructive", title: "Title is required" });
      return;
    }
    const preparedItems: CreateRfqItemInput[] = items
      .filter((item) => item.description.trim() && item.quantity.trim())
      .map((item) => ({
        description: item.description.trim(),
        unit: item.unit.trim() || undefined,
        quantity: Number(item.quantity),
      }));
    if (preparedItems.length === 0) {
      toast({ variant: "destructive", title: "Add at least one item" });
      return;
    }

    try {
      const rfq = await createRfq.mutateAsync({
        title: title.trim(),
        tenderId: tenderId || undefined,
        dueDate: dueDate || undefined,
        items: preparedItems,
        vendorIds: vendorIds.length > 0 ? vendorIds : undefined,
      });
      toast({ title: "RFQ created" });
      router.push(`/rfqs/${rfq.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create RFQ",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create RFQ</h1>
        <p className="text-sm text-muted-foreground">
          Request quotations from vendors for a set of items.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Cement Supply RFQ" />
          </div>
          <div className="grid grid-cols-2 gap-4">
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
            <div className="space-y-1">
              <label className="text-sm font-medium">Due date (optional)</label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Invite vendors (optional, can add later)</label>
            <MultiSelect
              options={(vendorsQuery.data?.items ?? []).map((v) => ({ value: v.id, label: v.name }))}
              selected={vendorIds}
              onChange={setVendorIds}
              placeholder="Select vendors to invite"
            />
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
                <TableHead className="w-32">Unit</TableHead>
                <TableHead className="w-32">Quantity</TableHead>
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
                      placeholder="500"
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
        </CardContent>
      </Card>

      <Button onClick={handleSubmit} disabled={createRfq.isPending}>
        {createRfq.isPending ? "Creating…" : "Create RFQ"}
      </Button>
    </div>
  );
}
