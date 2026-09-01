"use client";

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
import { AlertTriangle, Check, Pencil, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { useCategoryLeaves } from "@/hooks/use-categories";
import { useClassifyItem, useItem, useRenameItem, useSetItemCategory } from "@/hooks/use-items";
import { useAuthStore } from "@/lib/auth-store";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";
import { hasPermission } from "@/lib/permissions";

const UNCLASSIFIED = "none";

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
          {item.entries.length} price record(s){item.unit ? ` · unit: ${item.unit}` : ""}
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
                <Sparkles className="mr-2 h-4 w-4" />
                {classify.isPending ? "Asking AI…" : "Suggest with AI"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Price history</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tender</TableHead>
                  <TableHead>RFQ</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Make / Model</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {item.entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-20 text-center text-sm text-muted-foreground">
                      No priced quotes yet for this item.
                    </TableCell>
                  </TableRow>
                ) : (
                  item.entries.map((entry) => (
                    <TableRow key={entry.quoteId}>
                      <TableCell>
                        {entry.tenderId ? (
                          <Link href={`/tenders/${entry.tenderId}`} className="hover:underline">
                            {entry.tenderName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">Standalone</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link href={`/rfqs/${entry.rfqId}`} className="text-primary hover:underline">
                          {entry.rfqTitle}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/vendors/${entry.vendorId}`} className="hover:underline">
                          {entry.vendorName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {entry.rate.toLocaleString()}
                      </TableCell>
                      <TableCell>
                        {entry.make === "Unbranded" && entry.model === "Generic"
                          ? "-"
                          : `${entry.make} / ${entry.model}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {entry.quantity.toLocaleString()}
                      </TableCell>
                      <TableCell>{formatDate(entry.quotedAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
