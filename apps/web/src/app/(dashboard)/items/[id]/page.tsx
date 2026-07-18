"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  formatDate,
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
import { Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { useCategoryLeaves } from "@/hooks/use-categories";
import { useClassifyItem, useItem, useSetItemCategory } from "@/hooks/use-items";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const UNCLASSIFIED = "none";

export default function ItemDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canUpdate = hasPermission(roleName, "rfq:update");

  const itemQuery = useItem(params.id);
  const leavesQuery = useCategoryLeaves();
  const setCategory = useSetItemCategory(params.id);
  const classify = useClassifyItem(params.id);

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
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href="/items" className="text-sm text-muted-foreground hover:underline">
          ← Back to items
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{item.canonicalName}</h1>
        <p className="text-sm text-muted-foreground">
          {item.entries.length} price record(s){item.unit ? ` · unit: ${item.unit}` : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Classification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {item.categoryPath ? (
              <Badge variant={item.confirmed ? "default" : "secondary"}>
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
