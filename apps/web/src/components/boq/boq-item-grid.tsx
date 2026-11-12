"use client";

import { DEFAULT_GST_RATE, type BoqDto, type BoqItemDto, type RfqVendorSuggestionsDto } from "@bmp/types";
import { AiBadge, Badge, Button, EditableTreeTable, Input, useToast, type EditableTreeColumn } from "@bmp/ui";
import { AlertTriangle, Check, Send, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  useBulkUpdateBoqItems,
  useConfirmRateSource,
  useDeleteBoqItem,
  useRejectRateSource,
  useUpdateBoqItem,
} from "@/hooks/use-boq";
import { useSuggestRfqVendors } from "@/hooks/use-rfq";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

import { RateAnalysisDialog } from "./rate-analysis-dialog";
import { RateMatchCandidatesDialog } from "./rate-match-candidates-dialog";

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

/** Every number in a description, sorted — mirrors the server's spec-match.ts for the verify hint. */
function specNumbers(text: string): string {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))).sort().join(",");
}

export function BoqItemGrid({
  tenderId,
  boq,
  ratesLocked,
}: {
  tenderId: string;
  boq: BoqDto;
  /** Tender rates are finalized: every pricing edit (rate, markup, quantity, add/delete) is off. */
  ratesLocked: boolean;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canEdit = hasPermission(roleName, "boq:update") && boq.isCurrent;
  const canEditPricing = canEdit && !ratesLocked;
  const canSendRfq = hasPermission(roleName, "rfq:create");

  const updateItem = useUpdateBoqItem(tenderId);
  const deleteItem = useDeleteBoqItem(tenderId);
  const bulkUpdate = useBulkUpdateBoqItems(tenderId);
  const suggestVendors = useSuggestRfqVendors();
  const confirmRateSource = useConfirmRateSource(tenderId);
  const rejectRateSource = useRejectRateSource(tenderId);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkMarkup, setBulkMarkup] = useState("");
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
    field: "description" | "unit" | "quantity" | "rate" | "markupPercent" | "gstRate" | "hsnCode" | "unitWeightKg",
    value: string,
  ) {
    if (field === "unitWeightKg") {
      // Empty clears it (null); otherwise must be a positive number.
      const parsed = value === "" ? null : Number(value);
      if (parsed !== null && (Number.isNaN(parsed) || parsed <= 0)) {
        toast({ variant: "destructive", title: "Enter a unit weight above 0 kg" });
        return;
      }
      await commitUpdate(item, { unitWeightKg: parsed });
      return;
    }
    if (field === "hsnCode") {
      if (value !== "" && !/^\d{2,8}$/.test(value)) {
        toast({ variant: "destructive", title: "HSN code must be 2-8 digits" });
        return;
      }
      // Empty string is a real, meaningful value here (it clears hsnCodeConfirmed server-side) —
      // never coerce it to undefined like unit does below.
      await commitUpdate(item, { hsnCode: value });
      return;
    }
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
    if (field === "quantity" || field === "rate" || field === "markupPercent") {
      const parsed = value === "" ? undefined : Number(value);
      if (value !== "" && Number.isNaN(parsed)) {
        toast({ variant: "destructive", title: "Enter a valid number" });
        return;
      }
      await commitUpdate(item, { [field]: parsed });
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

  async function handleConfirmRateSource(item: BoqItemDto) {
    try {
      await confirmRateSource.mutateAsync({ itemId: item.id });
      toast({ title: "Rate confirmed and applied" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not confirm rate",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleRejectRateSource(item: BoqItemDto) {
    try {
      await rejectRateSource.mutateAsync(item.id);
      toast({ title: "Marked as not a match" });
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
    const markupPercent = Number(bulkMarkup);
    if (bulkMarkup === "" || Number.isNaN(markupPercent)) {
      toast({ variant: "destructive", title: "Enter a markup percentage" });
      return;
    }
    try {
      const result = await bulkUpdate.mutateAsync({ itemIds: [...selectedIds], markupPercent });
      const updated = selectedIds.size - result.skipped;
      toast({
        title: `Markup set to ${markupPercent}% on ${updated} item(s)`,
        description:
          result.skipped > 0
            ? `${result.skipped} item(s) skipped — they have no base rate from an RFQ yet.`
            : undefined,
      });
      setSelectedIds(new Set());
      setBulkMarkup("");
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
      // input shows that at any width, so this wraps (now correctly auto-sized to fit,
      // see EditableTreeTable) rather than needing a wide column to avoid wrapping.
      inputType: "textarea",
      widthClassName: "w-[26%] min-w-[14rem]",
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
      editable: canEditPricing,
      inputType: "number",
      getValue: (item) => item.quantity,
      onCommit: (item, value) => void commitField(item, "quantity", value),
    },
    {
      key: "baseRate",
      header: "Base rate",
      align: "right",
      render: (item) => {
        if (item.baseRate === null) return <span className="text-muted-foreground">-</span>;
        const source = item.baseRateSource;
        const makeModel =
          source && !(source.make === "Unbranded" && source.model === "Generic") ? `${source.make} / ${source.model} · ` : "";
        return (
          <div
            className="flex flex-col items-end"
            title={source ? `${makeModel}quoted ${new Date(source.quotedAt).toLocaleDateString()}` : undefined}
          >
            <span className="tabular-nums">{item.baseRate.toLocaleString()}</span>
            {source && (
              <span className="flex items-center gap-1">
                {source.technicalDeviation && (
                  <AlertTriangle
                    className="h-3.5 w-3.5 shrink-0 text-signal"
                    aria-label={`Technical deviation: ${source.technicalDeviation}`}
                  >
                    <title>{`Technical deviation: ${source.technicalDeviation}`}</title>
                  </AlertTriangle>
                )}
                <Link href={`/rfqs/${source.rfqId}`} className="max-w-[9rem] truncate text-xs text-muted-foreground hover:underline">
                  {source.vendorName}
                </Link>
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "markupPercent",
      header: "Markup %",
      align: "right",
      widthClassName: "w-24",
      // Only lines priced from a vendor base rate have something to mark up.
      editable: (item) => canEditPricing && item.baseRate !== null,
      inputType: "number",
      getValue: (item) => item.markupPercent ?? "",
      render: (item) =>
        item.markupPercent !== null ? (
          <span className="tabular-nums">{item.markupPercent}%</span>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
      onCommit: (item, value) => void commitField(item, "markupPercent", value),
    },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      editable: canEditPricing,
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
      key: "unitWeightKg",
      header: "Unit wt (kg)",
      align: "right",
      editable: canEdit,
      inputType: "number",
      widthClassName: "w-28",
      getValue: (item) => item.unitWeightKg ?? "",
      onCommit: (item, value) => void commitField(item, "unitWeightKg", value),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      getValue: (item) => item.amount?.toLocaleString() ?? "-",
    },
    {
      key: "hsnCode",
      header: "HSN Code",
      editable: canEdit,
      inputType: "number",
      widthClassName: "w-28",
      getValue: (item) => item.hsnCode ?? "",
      onCommit: (item, value) => void commitField(item, "hsnCode", value),
    },
    {
      key: "ai",
      header: "Item Category",
      render: (item) => {
        if (!item.aiEnrichedAt) return <span className="text-muted-foreground">-</span>;
        const confidence = item.aiConfidence ?? 0;
        const classification = [item.aiCategory, item.aiSubcategory].filter(Boolean).join(" · ");
        return (
          <div className="flex flex-wrap items-center gap-2" title={item.normalizedName ?? undefined}>
            {classification && <AiBadge>{classification}</AiBadge>}
            {item.suggestedHsnCode && item.suggestedHsnCode !== item.hsnCode && (
              <span className="flex items-center gap-1">
                <AiBadge>HSN {item.suggestedHsnCode}</AiBadge>
                {item.suggestedHsnSource && (
                  <span
                    className="max-w-[12rem] truncate text-xs text-muted-foreground"
                    title={`Confirmed on: ${item.suggestedHsnSource}`}
                  >
                    from {item.suggestedHsnSource}
                    {specNumbers(item.suggestedHsnSource) !== specNumbers(item.description) && " · verify spec"}
                  </span>
                )}
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => void commitField(item, "hsnCode", item.suggestedHsnCode!)}
                  >
                    Apply
                  </Button>
                )}
              </span>
            )}
            {item.suggestedRate !== null ? (
              <>
                <AiBadge className="tabular-nums">{item.suggestedRate.toLocaleString()}</AiBadge>
                <Badge variant={confidence >= 0.95 ? "success" : "outline"} className="text-xs">
                  {Math.round(confidence * 100)}%
                </Badge>
                {item.rateSourceConfirmed && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-label="Confirmed match" />
                )}
                {canEditPricing && (
                  <>
                    {!item.rateSourceConfirmed && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => void handleConfirmRateSource(item)}
                        disabled={confirmRateSource.isPending}
                      >
                        Apply
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 text-muted-foreground"
                      title="Not a match — this is a different item"
                      onClick={() => void handleRejectRateSource(item)}
                      disabled={rejectRateSource.isPending}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </>
            ) : (
              canEditPricing && (
                <RateMatchCandidatesDialog
                  tenderId={tenderId}
                  itemId={item.id}
                  itemDescription={item.description}
                  trigger={
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground">
                      Check possible matches
                    </Button>
                  }
                />
              )
            )}
          </div>
        );
      },
    },
  ];

  function goToCreateRfq() {
    const params = new URLSearchParams({ tenderId });
    if (selectedIds.size > 0) params.set("boqItemIds", [...selectedIds].join(","));
    router.push(`/rfqs/new?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      {canSendRfq && (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={goToCreateRfq}>
            <Send className="mr-2 h-4 w-4" /> Create RFQ
            {selectedIds.size > 0 && ` (${selectedIds.size} selected)`}
          </Button>
          {suggestions && suggestions.recommended.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs text-muted-foreground">Suggested:</span>
              {suggestions.recommended.map((rec) => (
                <Badge key={rec.vendorId} variant="outline" className="text-xs">
                  {rec.name} · {rec.coverageCount}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {canEditPricing && selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
          <span className="text-sm">{selectedIds.size} item(s) selected</span>
          <Input
            type="number"
            step="0.01"
            placeholder="Markup %"
            value={bulkMarkup}
            onChange={(e) => setBulkMarkup(e.target.value)}
            className="h-8 w-40"
          />
          <Button size="sm" onClick={handleBulkApply} disabled={bulkUpdate.isPending}>
            Set markup %
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      <EditableTreeTable
        data={boq.items}
        columns={columns}
        selectable={canEditPricing || canSendRfq}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        isRowSelectable={isLeaf}
        renderRowActions={
          canEditPricing
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
          {collectLeafIds(boq.items).length} line item(s).{" "}
          {ratesLocked
            ? "Rates are finalized — unlock them to edit pricing."
            : "Select rows to set a markup on their base rates."}
        </p>
      )}
    </div>
  );
}
