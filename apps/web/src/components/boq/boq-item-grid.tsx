"use client";

import type { BoqDto, BoqItemDto } from "@bmp/types";
import { Button, EditableTreeTable, Input, useToast, type EditableTreeColumn } from "@bmp/ui";
import { useState } from "react";

import { useBulkUpdateBoqItems, useUpdateBoqItem } from "@/hooks/use-boq";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

import { RateAnalysisDialog } from "./rate-analysis-dialog";

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

  const updateItem = useUpdateBoqItem(tenderId);
  const bulkUpdate = useBulkUpdateBoqItems(tenderId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [percentAdjustment, setPercentAdjustment] = useState("");

  async function commitField(item: BoqItemDto, field: "quantity" | "rate", value: string) {
    const parsed = value === "" ? undefined : Number(value);
    if (value !== "" && Number.isNaN(parsed)) {
      toast({ variant: "destructive", title: "Enter a valid number" });
      return;
    }
    const input = field === "quantity" ? { quantity: parsed } : { rate: parsed };
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
    { key: "description", header: "Description", getValue: (item) => item.description },
    { key: "unit", header: "Unit", getValue: (item) => item.unit ?? "-" },
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
      key: "amount",
      header: "Amount",
      align: "right",
      getValue: (item) => item.amount?.toLocaleString() ?? "-",
    },
  ];

  return (
    <div className="space-y-3">
      {canEdit && selectedIds.size > 0 && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3">
          <span className="text-sm">{selectedIds.size} item(s) selected</span>
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
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <EditableTreeTable
        data={boq.items}
        columns={columns}
        selectable={canEdit}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        isRowSelectable={isLeaf}
        renderRowActions={canEdit ? (item) => <RateAnalysisDialog tenderId={tenderId} item={item} /> : undefined}
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
