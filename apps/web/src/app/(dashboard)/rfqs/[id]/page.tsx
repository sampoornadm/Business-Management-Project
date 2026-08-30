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
  DialogTrigger,
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
  Textarea,
  useToast,
} from "@bmp/ui";
import { Send, ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { QuoteCell } from "@/components/rfq/quote-cell";
import { QuoteSheetActions } from "@/components/rfq/quote-sheet-actions";
import { useCreatePurchaseOrderFromRfq } from "@/hooks/use-purchase-orders";
import {
  useCloseRfq,
  useInviteVendor,
  usePreviewInviteVendor,
  usePushRatesToTender,
  useReopenRfq,
  useRemoveRfqVendor,
  useRfq,
  useRfqComparison,
  useSelectQuote,
  useUpsertRfqQuote,
} from "@/hooks/use-rfq";
import { useVendors } from "@/hooks/use-vendors";
import { useAuthStore } from "@/lib/auth-store";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";
import { hasPermission } from "@/lib/permissions";

const STATUS_VARIANT: Record<string, "success" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  SENT: "secondary",
  CLOSED: "success",
  CANCELLED: "destructive",
};

export default function RfqDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canUpdate = hasPermission(roleName, "rfq:update");
  const canCreatePo = hasPermission(roleName, "purchase_orders:create");
  const canSendRfq = hasPermission(roleName, "rfq:create");

  const rfqQuery = useRfq(params.id);
  useBreadcrumbLabel(params.id, rfqQuery.data?.title);
  const comparisonQuery = useRfqComparison(params.id);
  const vendorsQuery = useVendors({ page: 1, pageSize: 100, isActive: true });
  const removeVendor = useRemoveRfqVendor(params.id);
  const upsertQuote = useUpsertRfqQuote(params.id);
  const selectQuote = useSelectQuote(params.id);
  const pushRatesToTender = usePushRatesToTender(params.id);
  const previewInvite = usePreviewInviteVendor(params.id);
  const inviteVendorMutation = useInviteVendor(params.id);
  const closeRfq = useCloseRfq(params.id);
  const reopenRfq = useReopenRfq(params.id);
  const createPoFromRfq = useCreatePurchaseOrderFromRfq();

  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendVendorId, setSendVendorId] = useState("");
  const [sendText, setSendText] = useState("");

  async function handleSelectQuote(itemId: string, quoteId: string) {
    try {
      await selectQuote.mutateAsync({ itemId, quoteId });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not select quote",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handlePushRates() {
    try {
      const result = await pushRatesToTender.mutateAsync();
      toast({ title: `Pushed rates for ${result.updatedItems} item(s) to the tender` });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not push rates",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleSendRfq() {
    if (!sendVendorId) return;
    try {
      await inviteVendorMutation.mutateAsync({ vendorId: sendVendorId, text: sendText });
      toast({ title: "RFQ sent" });
      setSendDialogOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not send RFQ",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  useEffect(() => {
    if (!sendDialogOpen || !sendVendorId) return;
    let cancelled = false;
    previewInvite.mutateAsync({ vendorId: sendVendorId }).then((result) => {
      if (!cancelled) setSendText(result.text);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sendDialogOpen, sendVendorId]);

  async function handleClose() {
    try {
      await closeRfq.mutateAsync();
      toast({ title: "RFQ closed" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not close RFQ",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleReopen() {
    if (!window.confirm("This will reopen the RFQ for further quotes. Continue?")) return;
    try {
      await reopenRfq.mutateAsync();
      toast({ title: "RFQ reopened" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not reopen RFQ",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleCreatePo() {
    try {
      const pos = await createPoFromRfq.mutateAsync({ rfqId: params.id });
      toast({ title: `${pos.length} purchase order(s) created` });
      if (pos.length === 1) {
        router.push(`/purchase-orders/${pos[0]!.id}`);
      } else {
        router.push("/purchase-orders");
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create purchase order(s)",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (rfqQuery.isLoading || !rfqQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const rfq = rfqQuery.data;
  const isFinalized = rfq.status === "CLOSED" || rfq.status === "CANCELLED";

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{rfq.title}</h1>
            <Badge variant={STATUS_VARIANT[rfq.status]}>{rfq.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {rfq.itemCount} item(s) · {rfq.vendorCount} vendor(s) invited
            {rfq.dueDate ? ` · due ${formatDate(rfq.dueDate)}` : ""}
          </p>
        </div>
        {canUpdate && !isFinalized && (
          <Button variant="outline" onClick={handleClose} disabled={closeRfq.isPending}>
            Close RFQ
          </Button>
        )}
        {canUpdate && isFinalized && (
          <Button variant="outline" onClick={handleReopen} disabled={reopenRfq.isPending}>
            Reopen RFQ
          </Button>
        )}
        {canSendRfq && !isFinalized && (
          <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Send className="mr-2 h-4 w-4" /> Send RFQ
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Send RFQ</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Vendor</label>
                  <Select value={sendVendorId} onValueChange={setSendVendorId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a vendor" />
                    </SelectTrigger>
                    <SelectContent>
                      {(vendorsQuery.data?.items ?? []).map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Message</label>
                  <Textarea
                    rows={10}
                    value={sendText}
                    onChange={(e) => setSendText(e.target.value)}
                    disabled={previewInvite.isPending}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={handleSendRfq}
                  disabled={inviteVendorMutation.isPending || previewInvite.isPending || !sendVendorId}
                >
                  {inviteVendorMutation.isPending ? "Sending…" : "Send"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {rfq.status === "CLOSED" && canUpdate && (
          <Button variant="outline" onClick={handlePushRates} disabled={pushRatesToTender.isPending}>
            Push rates to tender
          </Button>
        )}
        {rfq.status === "CLOSED" && canCreatePo && (
          <Button onClick={handleCreatePo}>
            <ShoppingCart className="mr-2 h-4 w-4" /> Create Purchase Order(s)
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invited vendors</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {rfq.vendorInvites.length === 0 ? (
              <p className="text-sm text-muted-foreground">No vendors invited yet.</p>
            ) : (
              rfq.vendorInvites.map((invite) => (
                <Badge key={invite.id} variant="secondary" className="flex items-center gap-1">
                  {invite.vendor.name} · {invite.status}
                  {canUpdate && !isFinalized && (
                    <button
                      type="button"
                      onClick={async () => {
                        await removeVendor.mutateAsync(invite.vendor.id);
                      }}
                      aria-label={`Remove ${invite.vendor.name}`}
                    >
                      <Trash2 className="ml-1 h-3 w-3" />
                    </button>
                  )}
                </Badge>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base">Items & quotes</CardTitle>
          {canUpdate && !isFinalized && (
            <QuoteSheetActions
              rfqId={rfq.id}
              vendors={rfq.vendorInvites.map((v) => ({ id: v.vendor.id, name: v.vendor.name }))}
            />
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  {rfq.vendorInvites.map((invite) => (
                    <TableHead key={invite.id}>{invite.vendor.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rfq.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.description}</TableCell>
                    <TableCell>{item.unit ?? "-"}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    {rfq.vendorInvites.map((invite) => {
                      const quote = item.quotes.find((q) => q.vendorId === invite.vendor.id);
                      const hasMakeModel =
                        quote && (quote.make !== "Unbranded" || quote.model !== "Generic");
                      return (
                        <TableCell key={invite.id}>
                          {quote?.regretted ? (
                            // A regret is not a missing quote and not a rate of 0 — show it as such.
                            <Badge variant="outline">Regretted</Badge>
                          ) : (
                            <QuoteCell
                              initialRate={quote?.rate ?? null}
                              disabled={!canUpdate || isFinalized}
                              isSelected={quote?.isSelected ?? false}
                              selectable={Boolean(quote) && !quote?.regretted}
                              canSelect={canUpdate}
                              onSelect={() => quote && handleSelectQuote(item.id, quote.id)}
                              onCommit={(rate) =>
                                upsertQuote.mutate({ itemId: item.id, vendorId: invite.vendor.id, input: { rate } })
                              }
                            />
                          )}
                          {!quote?.regretted && hasMakeModel && (
                            <span className="mt-1 block text-xs text-muted-foreground">
                              {quote!.make} / {quote!.model}
                            </span>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {comparisonQuery.data && comparisonQuery.data.vendorTotals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparative statement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4">
              {comparisonQuery.data.vendorTotals.map((total, index) => (
                <div key={total.vendorId} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center gap-1 font-medium">
                    {total.vendorName}{" "}
                    {total.itemsQuoted === 0 ? (
                      // A wholly-regretting vendor sorts first with total 0 — "priced nothing",
                      // never "Lowest". itemsQuoted===0 is the honest test, not total===0.
                      <Badge variant="outline" className="ml-1">
                        Priced nothing
                      </Badge>
                    ) : (
                      index === 0 && <Badge className="ml-1">Lowest</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground">
                    Total: {total.total.toLocaleString()} ({total.itemsQuoted} item(s) quoted)
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {rfq.tenderId && (
        <Link href={`/tenders/${rfq.tenderId}`} className="text-sm text-primary hover:underline">
          View linked tender
        </Link>
      )}
    </div>
  );
}
