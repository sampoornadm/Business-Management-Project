"use client";

import type { BoqItemDto, CreateRfqItemInput, RfqVendorSuggestionsDto } from "@bmp/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
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
import { useEffect, useState } from "react";

import { useCurrentBoq } from "@/hooks/use-boq";
import { useCreateRfq, useSuggestRfqVendors } from "@/hooks/use-rfq";
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

function flattenBoqItems(items: BoqItemDto[]): BoqItemDto[] {
  return items.flatMap((item) => [item, ...flattenBoqItems(item.children)]);
}

export default function NewRfqPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createRfq = useCreateRfq();
  const suggestVendors = useSuggestRfqVendors();
  const tendersQuery = useTenders({ page: 1, pageSize: 100 });
  const vendorsQuery = useVendors({ page: 1, pageSize: 100, isActive: true });

  const [title, setTitle] = useState("");
  const [tenderId, setTenderId] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [selectedBoqItemIds, setSelectedBoqItemIds] = useState<string[]>([]);
  const [vendorIds, setVendorIds] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<RfqVendorSuggestionsDto>();

  const boqQuery = useCurrentBoq(tenderId || undefined);
  const boqItems = boqQuery.data ? flattenBoqItems(boqQuery.data.items) : [];
  const usingBoqPicker = Boolean(tenderId) && boqItems.length > 0;

  useEffect(() => {
    if (!usingBoqPicker || selectedBoqItemIds.length === 0) {
      setSuggestions(undefined);
      return;
    }
    let cancelled = false;
    suggestVendors.mutateAsync({ boqItemIds: selectedBoqItemIds }).then((result) => {
      if (!cancelled) setSuggestions(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBoqItemIds.join(","), usingBoqPicker]);

  function toggleBoqItem(itemId: string, checked: boolean) {
    setSelectedBoqItemIds((prev) => (checked ? [...prev, itemId] : prev.filter((id) => id !== itemId)));
  }

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  function addSuggestedVendor(vendorId: string) {
    setVendorIds((prev) => (prev.includes(vendorId) ? prev : [...prev, vendorId]));
  }

  async function handleSubmit() {
    if (!title.trim()) {
      toast({ variant: "destructive", title: "Title is required" });
      return;
    }

    const preparedItems: CreateRfqItemInput[] = usingBoqPicker
      ? boqItems
          .filter((item) => selectedBoqItemIds.includes(item.id))
          .map((item) => ({
            boqItemId: item.id,
            description: item.description,
            unit: item.unit ?? undefined,
            quantity: item.quantity ?? 0,
          }))
      : items
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
              <Select
                value={tenderId || "__none__"}
                onValueChange={(v) => {
                  setTenderId(v === "__none__" ? "" : v);
                  setSelectedBoqItemIds([]);
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
            {suggestions && suggestions.recommended.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-xs text-muted-foreground">Suggested, based on item tags:</span>
                {suggestions.recommended.map((rec) => (
                  <button key={rec.vendorId} type="button" onClick={() => addSuggestedVendor(rec.vendorId)}>
                    <Badge variant={vendorIds.includes(rec.vendorId) ? "default" : "outline"}>
                      {rec.name} · covers {rec.coverageCount}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Items</CardTitle>
          {!usingBoqPicker && (
            <Button size="sm" variant="outline" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
              <Plus className="mr-2 h-4 w-4" /> Add item
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {usingBoqPicker ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Pick the items from this tender&apos;s BOQ to request quotes for.
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Description</TableHead>
                    <TableHead className="w-24">Unit</TableHead>
                    <TableHead className="w-24">Quantity</TableHead>
                    <TableHead className="w-56">Suggested vendors</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boqItems.map((item) => {
                    const perItem = suggestions?.perItem.find((s) => s.boqItemId === item.id);
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Checkbox
                            checked={selectedBoqItemIds.includes(item.id)}
                            onCheckedChange={(checked) => toggleBoqItem(item.id, Boolean(checked))}
                          />
                        </TableCell>
                        <TableCell className="max-w-md text-sm">{item.description}</TableCell>
                        <TableCell>{item.unit ?? "-"}</TableCell>
                        <TableCell>{item.quantity ?? "-"}</TableCell>
                        <TableCell>
                          {perItem && perItem.suggestedVendors.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {perItem.suggestedVendors.map((v) => (
                                <Badge key={v.vendorId} variant="outline" className="text-xs">
                                  {v.name}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            selectedBoqItemIds.includes(item.id) && (
                              <span className="text-xs text-muted-foreground">No tagged vendor match</span>
                            )
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="space-y-3">
              {tenderId && (
                <p className="text-sm text-muted-foreground">
                  This tender has no BOQ items yet — enter items manually below.
                </p>
              )}
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
            </div>
          )}
        </CardContent>
      </Card>

      <Button onClick={handleSubmit} disabled={createRfq.isPending}>
        {createRfq.isPending ? "Creating…" : "Create RFQ"}
      </Button>
    </div>
  );
}
