"use client";

import { formatItemCodeForDisplay, type ItemOwnRateDto, type ItemVendorRateDto } from "@bmp/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatDate,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bmp/ui";
import { AlertTriangle, Check, Loader2, Pencil, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { useCategoryLeaves } from "@/hooks/use-categories";
import { useClassifyItem, useItem, useRenameItem, useSetItemCategory } from "@/hooks/use-items";
import { useAuthStore } from "@/lib/auth-store";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";
import { hasPermission } from "@/lib/permissions";

const UNCLASSIFIED = "none";
/** Rate histories show this many recent years by default; older rows sit behind "Show all". */
const RECENT_YEARS = 5;

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canUpdate = hasPermission(roleName, "rfq:update");

  const itemQuery = useItem(params.id);
  useBreadcrumbLabel(params.id, itemQuery.data?.canonicalName);
  const leavesQuery = useCategoryLeaves();
  const setCategory = useSetItemCategory(params.id);
  const classify = useClassifyItem(params.id);
  const renameItem = useRenameItem(params.id);

  const [isRenaming, setIsRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  function openRename(canonicalName: string) {
    setNameDraft(canonicalName);
    setIsRenaming(true);
  }

  async function handleRename() {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    try {
      await renameItem.mutateAsync({ canonicalName: trimmed });
      toast({ title: "Item renamed" });
      setIsRenaming(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not rename item",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleSelect(value: string) {
    try {
      await setCategory.mutateAsync({ categoryId: value === UNCLASSIFIED ? null : value, confirmed: true });
      toast({ title: "Category updated" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update category",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleConfirm() {
    if (!item.categoryId) return;
    await setCategory.mutateAsync({ categoryId: item.categoryId, confirmed: true });
    toast({ title: "Category confirmed" });
  }

  async function handleSuggest() {
    try {
      await classify.mutateAsync();
      toast({ title: "AI suggestion applied", description: "Review and confirm below." });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not classify",
        description: error instanceof Error ? error.message : "Is the local AI (Ollama) running?",
      });
    }
  }

  if (itemQuery.isLoading || !itemQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const item = itemQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/items" className="text-sm text-muted-foreground hover:underline">
          ← Back to items
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{item.canonicalName}</h1>
          {canUpdate && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openRename(item.canonicalName)}
              aria-label="Rename item"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {item.itemCode ? `Code ${formatItemCodeForDisplay(item.itemCode)} · ` : ""}
          {item.vendorRates.length} vendor rate(s) · {item.ownRates.length} of my rate(s)
          {item.unit ? ` · unit: ${item.unit}` : ""}
        </p>
      </div>

      <Dialog open={isRenaming} onOpenChange={setIsRenaming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename item</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This is the item&apos;s refined, concise name — the single source of truth used for
              vendor-facing text, rate matching, and price history grouping going forward. It
              doesn&apos;t change any tender&apos;s own BOQ description.
            </p>
            <Input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleRename()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRenaming(false)}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={renameItem.isPending || !nameDraft.trim()}>
              {renameItem.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {item.needsReview && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                The AI reported high confidence here, but this item didn&apos;t closely resemble
                anything already classified — the kind of gap where it force-fits a category
                instead of admitting it doesn&apos;t know. Worth a closer look before confirming.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {item.categoryPath ? (
              <Badge variant={item.confirmed ? "success" : "secondary"}>
                {item.confirmed ? item.categoryPath : `AI: ${item.categoryPath}`}
              </Badge>
            ) : (
              <span className="text-sm text-muted-foreground">Unclassified</span>
            )}
            {!item.confirmed && item.aiConfidence !== null && (
              <span className="text-xs text-muted-foreground">
                {Math.round(item.aiConfidence * 100)}% confidence — please confirm
              </span>
            )}
          </div>

          {canUpdate && (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={item.categoryId ?? UNCLASSIFIED}
                onValueChange={handleSelect}
                disabled={setCategory.isPending || leavesQuery.isLoading}
              >
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Set category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCLASSIFIED}>Unclassified</SelectItem>
                  {(leavesQuery.data ?? []).map((leaf) => (
                    <SelectItem key={leaf.id} value={leaf.id}>
                      {leaf.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {item.categoryId && !item.confirmed && (
                <Button variant="outline" onClick={handleConfirm} disabled={setCategory.isPending}>
                  <Check className="mr-2 h-4 w-4" /> Confirm
                </Button>
              )}

              <Button variant="outline" onClick={handleSuggest} disabled={classify.isPending}>
                {classify.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                {classify.isPending ? "Asking AI…" : "Suggest with AI"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <VendorRatesCard rates={item.vendorRates} />
      <OwnRatesCard rates={item.ownRates} />
    </div>
  );
}

/** Rows from the last RECENT_YEARS years unless `showAll`; also how many older rows are hidden. */
function useRecent<T extends { effectiveDate: string }>(rows: T[]) {
  const [showAll, setShowAll] = useState(false);
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RECENT_YEARS);
  const recent = rows.filter((row) => new Date(row.effectiveDate) >= cutoff);
  return { visible: showAll ? rows : recent, hiddenCount: rows.length - recent.length, showAll, setShowAll };
}

function ShowAllToggle({ hiddenCount, showAll, onToggle }: { hiddenCount: number; showAll: boolean; onToggle: () => void }) {
  if (hiddenCount === 0) return null;
  return (
    <Button variant="ghost" size="sm" onClick={onToggle}>
      {showAll ? `Show last ${RECENT_YEARS} years` : `Show all (${hiddenCount} older)`}
    </Button>
  );
}

function VendorRatesCard({ rates }: { rates: ItemVendorRateDto[] }) {
  const { visible, hiddenCount, showAll, setShowAll } = useRecent(rates);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Vendor rates</CardTitle>
        <ShowAllToggle hiddenCount={hiddenCount} showAll={showAll} onToggle={() => setShowAll(!showAll)} />
      </CardHeader>
      <CardContent>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Make / Model</TableHead>
                <TableHead>RFQ</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-sm text-muted-foreground">
                    No vendor rates yet — they are recorded when an RFQ&apos;s rates are finalized.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {row.vendorId ? (
                          <Link href={`/vendors/${row.vendorId}`} className="hover:underline">
                            {row.vendorName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                        {row.isDefault && <Badge variant="secondary">Selected</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{row.rate.toLocaleString()}</TableCell>
                    <TableCell>
                      {!row.make || (row.make === "Unbranded" && row.model === "Generic") ? "-" : `${row.make} / ${row.model}`}
                    </TableCell>
                    <TableCell>
                      {row.rfqId ? (
                        <Link href={`/rfqs/${row.rfqId}`} className="text-primary hover:underline">
                          View RFQ
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{formatDate(row.effectiveDate)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function OwnRatesCard({ rates }: { rates: ItemOwnRateDto[] }) {
  const { visible, hiddenCount, showAll, setShowAll } = useRecent(rates);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">My rates</CardTitle>
        <ShowAllToggle hiddenCount={hiddenCount} showAll={showAll} onToggle={() => setShowAll(!showAll)} />
      </CardHeader>
      <CardContent>
        <div className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tender</TableHead>
                <TableHead className="text-right">My rate</TableHead>
                <TableHead className="text-right">Base rate</TableHead>
                <TableHead className="text-right">Markup</TableHead>
                <TableHead>Submitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-20 text-center text-sm text-muted-foreground">
                    No rates of mine yet — they are recorded when a tender is submitted.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.tenderId ? (
                        <Link href={`/tenders/${row.tenderId}`} className="hover:underline">
                          {row.tenderNumber ?? "Tender"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{row.rate.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.baseRate?.toLocaleString() ?? "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.markupPercent !== null ? `${row.markupPercent}%` : "-"}
                    </TableCell>
                    <TableCell>{formatDate(row.effectiveDate)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
