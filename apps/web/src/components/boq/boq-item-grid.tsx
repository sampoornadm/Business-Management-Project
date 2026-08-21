"use client";

import { DEFAULT_GST_RATE, type BoqDto, type BoqItemDto, type RfqVendorSuggestionsDto } from "@bmp/types";
import { Badge, Button, EditableTreeTable, Input, useToast, type EditableTreeColumn } from "@bmp/ui";
import { Send, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useBulkUpdateBoqItems, useDeleteBoqItem, useUpdateBoqItem } from "@/hooks/use-boq";
import { useSuggestRfqVendors } from "@/hooks/use-rfq";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

import { RateAnalysisDialog } from "./rate-analysis-dialog";
import { SendRfqDialog } from "./send-rfq-dialog";

function isLeaf(item: BoqItemDto): boolean {
  return item.children.length === 0;
}

function collectLeafIds(items: BoqItemDto[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (isLeaf(item)) ids.push(item.id);
    else ids.push(...collectLeafIds(item.children));
  }
  return ids;
}

export function BoqItemGrid({ tenderId, boq }: { tenderId: string; boq: BoqDto }) {
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canEdit = hasPermission(roleName, "boq:update") && boq.isCurrent;
  const canSendRfq = hasPermission(roleName, "rfq:create");

  const updateItem = useUpdateBoqItem(tenderId);
  const deleteItem = useDeleteBoqItem(tenderId);
  const bulkUpdate = useBulkUpdateBoqItems(tenderId);
  const suggestVendors = useSuggestRfqVendors();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [percentAdjustment, setPercentAdjustment] = useState("");
  const [suggestions, setSuggestions] = useState<RfqVendorSuggestionsDto>();

  useEffect(() => {
    if (!canSendRfq || selectedIds.size === 0) {
      setSuggestions(undefined);
      return;
    }
    let cancelled = false;
    suggestVendors.mutateAsync({ boqItemIds: [...selectedIds] }).then((result) => {
      if (!cancelled) setSuggestions(result);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSendRfq, [...selectedIds].join(",")]);

  async function commitField(
    item: BoqItemDto,
    field: "description" | "unit" | "quantity" | "rate" | "gstRate",
    value: string,
  ) {
    if (field === "gstRate") {
      // Unlike quantity/rate, GST is non-nullable — a cleared box means "back to default".
      const parsed = value === "" ? DEFAULT_GST_RATE : Number(value);
      if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
        toast({ variant: "destructive", title: "Enter a GST rate between 0 and 100" });
        return;
      }
      await commitUpdate(item, { gstRate: parsed });
      return;
    }
    if (field === "quantity" || field === "rate") {
      const parsed = value === "" ? undefined : Number(value);
      if (value !== "" && Number.isNaN(parsed)) {
        toast({ variant: "destructive", title: "Enter a valid number" });
        return;
      }
      await commitUpdate(item, field === "quantity" ? { quantity: parsed } : { rate: parsed });
      return;
    }
    if (field === "description" && value.trim() === "") {
      toast({ variant: "destructive", title: "Description cannot be empty" });
      return;
    }
    await commitUpdate(item, field === "description" ? { description: value } : { unit: value || undefined });
  }

  async function commitUpdate(item: BoqItemDto, input: Parameters<typeof updateItem.mutateAsync>[0]["input"]) {
    try {
      await updateItem.mutateAsync({ itemId: item.id, input });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update item",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleDelete(item: BoqItemDto) {
    if (!window.confirm(`Delete "${item.description}"?`)) return;
    try {
      await deleteItem.mutateAsync(item.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete item",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleBulkApply() {
    const adjustment = Number(percentAdjustment);
    if (percentAdjustment === "" || Number.isNaN(adjustment)) {
      toast({ variant: "destructive", title: "Enter a percentage" });
      return;
    }
    try {
      await bulkUpdate.mutateAsync({ itemIds: [...selectedIds], ratePercentAdjustment: adjustment });
      toast({ title: `Adjusted ${selectedIds.size} item(s) by ${adjustment}%` });
      setSelectedIds(new Set());
      setPercentAdjustment("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Bulk update failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  const columns: EditableTreeColumn<BoqItemDto>[] = [
    {
      key: "description",
      header: "Description",
      editable: canEdit,
      // Real tender descriptions run to ~180 chars ("TUBE MATERIAL : POLYURETHANE WORKING
      // PRESSURE : ... HARDNESS: SHORE A98, MINIMUM BEND RADIUS: 30 MM") — no single-line
      // input shows that at any width, so this wraps and takes the lion's share of the row.
      inputType: "textarea",
      widthClassName: "w-[38%] min-w-[22rem]",
      getValue: (item) => item.description,
      onCommit: (item, value) => void commitField(item, "description", value),
      render: (item) => <span className="whitespace-pre-wrap break-words">{item.description}</span>,
    },
    {
      key: "unit",
      header: "Unit",
      editable: canEdit,
      getValue: (item) => item.unit ?? "",
      onCommit: (item, value) => void commitField(item, "unit", value),
    },
    {
      key: "quantity",
      header: "Quantity",
      align: "right",
      editable: canEdit,
      inputType: "number",
      getValue: (item) => item.quantity,
      onCommit: (item, value) => void commitField(item, "quantity", value),
    },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      editable: canEdit,
      inputType: "number",
      getValue: (item) => item.rate,
      onCommit: (item, value) => void commitField(item, "rate", value),
    },
    {
      key: "gstRate",
      header: "GST %",
      align: "right",
      editable: canEdit,
      inputType: "number",
      widthClassName: "w-24",
      getValue: (item) => item.gstRate,
      onCommit: (item, value) => void commitField(item, "gstRate", value),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      getValue: (item) => item.amount?.toLocaleString() ?? "-",
    },
    {
      key: "ai",
      header: "AI suggestion",
      render: (item) => {
        if (!item.aiEnrichedAt) return <span className="text-muted-foreground">-</span>;
        const confidence = item.aiConfidence ?? 0;
        const classification = [item.aiCategory, item.aiSubcategory].filter(Boolean).join(" · ");
        return (
          <div className="flex items-center gap-2" title={item.normalizedName ?? undefined}>
            {classification && (
              <Badge variant="secondary" className="text-xs font-normal">
                {classification}
              </Badge>
            )}
            {item.suggestedRate !== null && (
              <>
                <span className="tabular-nums">{item.suggestedRate.toLocaleString()}</span>
                <Badge variant={confidence >= 0.95 ? "success" : "outline"} className="text-xs">
                  {Math.round(confidence * 100)}%
                </Badge>
                {canEdit && item.rate !== item.suggestedRate && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => void commitUpdate(item, { rate: item.suggestedRate ?? undefined })}
                    disabled={updateItem.isPending}
                  >
                    Apply
                  </Button>
                )}
              </>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      {(canEdit || canSendRfq) && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
          <span className="text-sm">{selectedIds.size} item(s) selected</span>
          {canEdit && (
            <>
              <Input
                type="number"
                step="0.01"
                placeholder="% adjustment"
                value={percentAdjustment}
                onChange={(e) => setPercentAdjustment(e.target.value)}
                className="h-8 w-40"
              />
              <Button size="sm" onClick={handleBulkApply} disabled={bulkUpdate.isPending}>
                Apply to rates
              </Button>
            </>
          )}
          {canSendRfq && (
            <SendRfqDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Send className="mr-2 h-4 w-4" /> Send RFQ
                </Button>
              }
              tenderId={tenderId}
              boqItemIds={[...selectedIds]}
              suggestedVendorId={suggestions?.recommended[0]?.vendorId}
              onSent={() => setSelectedIds(new Set())}
            />
          )}
          {canSendRfq && suggestions && suggestions.recommended.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">Suggested:</span>
              {suggestions.recommended.map((rec) => (
                <Badge key={rec.vendorId} variant="outline" className="text-xs">
                  {rec.name} · {rec.coverageCount}
                </Badge>
              ))}
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <EditableTreeTable
        data={boq.items}
        columns={columns}
        selectable={canEdit || canSendRfq}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        isRowSelectable={isLeaf}
        renderRowActions={
          canEdit
            ? (item) => (
                <div className="flex items-center gap-1">
                  <RateAnalysisDialog tenderId={tenderId} item={item} />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8"
                    onClick={() => void handleDelete(item)}
                    disabled={deleteItem.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )
            : undefined
        }
        emptyMessage="No BOQ items yet."
      />

      {canEdit && boq.items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {collectLeafIds(boq.items).length} line item(s). Select rows to apply a bulk rate adjustment.
        </p>
      )}
    </div>
  );
}
