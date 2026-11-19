"use client";

import type { ClientPurchaseOrderDto, ClientPurchaseOrderItemInput, UnorderedBoqItemDto } from "@bmp/types";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatMoney,
  Input,
  Label,
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
import { FileText, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useCurrentBoq } from "@/hooks/use-boq";
import { useExtractClientPurchaseOrder, useSaveClientPurchaseOrder } from "@/hooks/use-client-purchase-orders";

const NOT_IN_BOQ = "__none__";

interface DraftItem {
  /** Set for a saved line, so editing keeps it (a shipped line must keep its id). */
  id?: string;
  boqItemId: string;
  itemCode: string;
  description: string;
  unit: string;
  quantity: string;
  rate: string;
}

const emptyItem = (): DraftItem => ({ boqItemId: NOT_IN_BOQ, itemCode: "", description: "", unit: "", quantity: "", rate: "" });

function toDraft(item: Partial<ClientPurchaseOrderItemInput> & { description: string }): DraftItem {
  return {
    id: item.id,
    boqItemId: item.boqItemId ?? NOT_IN_BOQ,
    itemCode: item.itemCode ?? "",
    description: item.description,
    unit: item.unit ?? "",
    quantity: item.quantity !== undefined ? String(item.quantity) : "",
    rate: item.rate !== undefined ? String(item.rate) : "",
  };
}

interface ClientPurchaseOrderDialogProps {
  projectId: string;
  tenderId: string;
  deliveryPeriodDays: number;
  /** BOQ lines no PO orders yet, offered as a one-click start. */
  unorderedBoqItems: UnorderedBoqItemDto[];
  /** Set to edit an existing PO. */
  order?: ClientPurchaseOrderDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClientPurchaseOrderDialog({
  projectId,
  tenderId,
  deliveryPeriodDays,
  unorderedBoqItems,
  order,
  open,
  onOpenChange,
}: ClientPurchaseOrderDialogProps) {
  const { toast } = useToast();
  const boqQuery = useCurrentBoq(tenderId);
  const extract = useExtractClientPurchaseOrder(projectId);
  const save = useSaveClientPurchaseOrder(projectId);

  const [file, setFile] = useState<File | null>(null);
  const [poNumber, setPoNumber] = useState(order?.poNumber ?? "");
  const [poDate, setPoDate] = useState(order?.poDate.slice(0, 10) ?? "");
  const [deliveryDueDate, setDeliveryDueDate] = useState(order?.deliveryDueDate.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [items, setItems] = useState<DraftItem[]>(order ? order.items.map(toDraft) : [emptyItem()]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [documentTotal, setDocumentTotal] = useState<number | undefined>();

  // A parent heading is not orderable; only leaf lines are offered.
  const boqLines = useMemo(() => {
    const all = boqQuery.data?.items ?? [];
    const parents = new Set(all.map((item) => item.parentId).filter(Boolean));
    return all.filter((item) => !parents.has(item.id));
  }, [boqQuery.data]);
  const boqById = useMemo(() => new Map(boqLines.map((line) => [line.id, line])), [boqLines]);

  function updateItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function pickBoqLine(index: number, boqItemId: string) {
    const line = boqById.get(boqItemId);
    if (!line) {
      updateItem(index, { boqItemId: NOT_IN_BOQ });
      return;
    }
    setItems((prev) =>
      prev.map((item, i) =>
        i === index
          ? {
              id: item.id,
              boqItemId,
              itemCode: line.itemCode ?? "",
              description: item.description || line.description,
              unit: item.unit || line.unit || "",
              quantity: item.quantity || (line.quantity !== null ? String(line.quantity) : ""),
              rate: item.rate || (line.rate !== null ? String(line.rate) : ""),
            }
          : item,
      ),
    );
  }

  function addUnorderedLines() {
    const drafts = unorderedBoqItems.map((line) =>
      toDraft({ ...line, quantity: line.quantity ?? undefined, rate: line.rate ?? undefined }),
    );
    setItems((prev) => [...prev.filter((item) => item.description.trim()), ...drafts]);
  }

  async function readDocument() {
    if (!file) return;
    try {
      const draft = await extract.mutateAsync(file);
      if (draft.poNumber) setPoNumber(draft.poNumber);
      if (draft.poDate) setPoDate(draft.poDate);
      if (draft.deliveryDueDate) setDeliveryDueDate(draft.deliveryDueDate);
      if (draft.items.length > 0) setItems(draft.items.map(toDraft));
      setWarnings(draft.warnings);
      setDocumentTotal(draft.documentTotal);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not read the document",
        description: error instanceof Error ? error.message : "Fill the form by hand.",
      });
    }
  }

  const total = items.reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.rate) || 0), 0);

  async function handleSave() {
    const prepared = items
      .filter((item) => item.description.trim() && Number(item.quantity) > 0 && item.rate.trim())
      .map((item) => ({
        id: item.id,
        boqItemId: item.boqItemId === NOT_IN_BOQ ? null : item.boqItemId,
        itemCode: item.itemCode.trim() || null,
        description: item.description.trim(),
        unit: item.unit.trim() || null,
        quantity: Number(item.quantity),
        rate: Number(item.rate),
      }));
    if (!poNumber.trim() || !poDate) {
      toast({ variant: "destructive", title: "Enter the PO number and PO date" });
      return;
    }
    if (prepared.length === 0) {
      toast({ variant: "destructive", title: "Add at least one item with a quantity and rate" });
      return;
    }
    try {
      await save.mutateAsync({
        orderId: order?.id,
        input: {
          poNumber: poNumber.trim(),
          poDate,
          deliveryDueDate: deliveryDueDate || undefined,
          notes: notes.trim() || null,
          items: prepared,
        },
        file,
      });
      toast({ title: order ? "Client PO updated" : "Client PO recorded" });
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save the client PO",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{order ? `Edit client PO ${order.poNumber}` : "Record client PO"}</DialogTitle>
          <DialogDescription>
            Upload the PO the client sent to fill the form, then check each line against our quoted rate.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="client-po-file">PO document</Label>
              <Input
                id="client-po-file"
                type="file"
                accept="application/pdf,image/*,.docx,.xlsx,.doc,.xls"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </div>
            <Button variant="outline" onClick={readDocument} disabled={!file || extract.isPending}>
              <FileText className="mr-2 h-4 w-4" />
              {extract.isPending ? "Reading…" : "Read document"}
            </Button>
          </div>
          {order && order.documents.length > 0 && !file && (
            <p className="text-sm text-muted-foreground">
              Attached: {order.documents.map((doc) => doc.originalName).join(", ")}. Picking a file adds it.
            </p>
          )}
          {warnings.length > 0 && (
            <ul className="list-disc space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 pl-7 text-sm">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="client-po-number">PO number</Label>
              <Input id="client-po-number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="client-po-date">PO date</Label>
              <Input id="client-po-date" type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="client-po-due">Delivery due date</Label>
              <Input
                id="client-po-due"
                type="date"
                value={deliveryDueDate}
                onChange={(e) => setDeliveryDueDate(e.target.value)}
              />
              {!deliveryDueDate && (
                <p className="text-xs text-muted-foreground">Blank uses the PO date plus {deliveryPeriodDays} days.</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">Items</p>
            <div className="flex flex-wrap gap-2">
              {unorderedBoqItems.length > 0 && (
                <Button size="sm" variant="outline" onClick={addUnorderedLines}>
                  Add {unorderedBoqItems.length} unordered BOQ line{unorderedBoqItems.length === 1 ? "" : "s"}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
                <Plus className="mr-2 h-4 w-4" /> Add item
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-56">BOQ line</TableHead>
                  <TableHead className="min-w-56">Description</TableHead>
                  <TableHead className="w-24">Unit</TableHead>
                  <TableHead className="w-28">Quantity</TableHead>
                  <TableHead className="w-32">PO rate</TableHead>
                  <TableHead className="w-32 text-right">Our rate</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => {
                  const ourRate = boqById.get(item.boqItemId)?.rate ?? null;
                  const differs = ourRate !== null && item.rate.trim() !== "" && Math.abs(Number(item.rate) - ourRate) > 0.005;
                  return (
                    <TableRow key={index}>
                      <TableCell>
                        <Select value={item.boqItemId} onValueChange={(value) => pickBoqLine(index, value)}>
                          <SelectTrigger aria-label="BOQ line">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NOT_IN_BOQ}>Not in our BOQ</SelectItem>
                            {boqLines.map((line) => (
                              <SelectItem key={line.id} value={line.id}>
                                {line.itemCode ? `${line.itemCode} · ` : ""}
                                {line.description.slice(0, 70)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label="Description"
                          value={item.description}
                          onChange={(e) => updateItem(index, { description: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input aria-label="Unit" value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })} />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label="Quantity"
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateItem(index, { quantity: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          aria-label="PO rate"
                          money
                          value={item.rate}
                          onChange={(e) => updateItem(index, { rate: e.target.value })}
                          className={differs ? "border-destructive" : undefined}
                        />
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${differs ? "text-destructive" : "text-muted-foreground"}`}>
                        {ourRate !== null ? formatMoney(ourRate) : "–"}
                      </TableCell>
                      <TableCell>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="Remove item"
                          onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <div className="text-right text-sm">
            <p className="font-medium">PO value: {formatMoney(total)}</p>
            {documentTotal !== undefined && (
              <p className="text-muted-foreground">Total stated on the document: {formatMoney(documentTotal)}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="client-po-notes">Notes</Label>
            <Textarea id="client-po-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSave} disabled={save.isPending}>
            {save.isPending ? "Saving…" : order ? "Save client PO" : "Record client PO"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
