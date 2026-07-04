"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { ShoppingCart, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { QuoteCell } from "@/components/rfq/quote-cell";
import { useCreatePurchaseOrderFromRfq } from "@/hooks/use-purchase-orders";
import {
  useAddRfqVendor,
  useAwardRfq,
  useCloseRfq,
  useRemoveRfqVendor,
  useRfq,
  useRfqComparison,
  useUpsertRfqQuote,
} from "@/hooks/use-rfq";
import { useVendors } from "@/hooks/use-vendors";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  SENT: "secondary",
  CLOSED: "secondary",
  AWARDED: "default",
  CANCELLED: "destructive",
};

export default function RfqDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canUpdate = hasPermission(roleName, "rfq:update");
  const canCreatePo = hasPermission(roleName, "purchase_orders:create");

  const rfqQuery = useRfq(params.id);
  const comparisonQuery = useRfqComparison(params.id);
  const vendorsQuery = useVendors({ page: 1, pageSize: 100, isActive: true });
  const addVendor = useAddRfqVendor(params.id);
  const removeVendor = useRemoveRfqVendor(params.id);
  const upsertQuote = useUpsertRfqQuote(params.id);
  const awardRfq = useAwardRfq(params.id);
  const closeRfq = useCloseRfq(params.id);
  const createPoFromRfq = useCreatePurchaseOrderFromRfq();

  const [inviteVendorId, setInviteVendorId] = useState("");
  const [awardVendorId, setAwardVendorId] = useState("");

  async function handleInvite() {
    if (!inviteVendorId) return;
    try {
      await addVendor.mutateAsync(inviteVendorId);
      setInviteVendorId("");
      toast({ title: "Vendor invited" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not invite vendor",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleAward() {
    if (!awardVendorId) return;
    try {
      await awardRfq.mutateAsync({ vendorId: awardVendorId });
      toast({ title: "RFQ awarded" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not award RFQ",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

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

  async function handleCreatePo() {
    try {
      const po = await createPoFromRfq.mutateAsync({ rfqId: params.id });
      toast({ title: "Purchase order created" });
      router.push(`/purchase-orders/${po.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create purchase order",
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
  const isFinalized = rfq.status === "AWARDED" || rfq.status === "CLOSED" || rfq.status === "CANCELLED";
  const invitedIds = new Set(rfq.vendorInvites.map((v) => v.vendor.id));
  const availableVendors = (vendorsQuery.data?.items ?? []).filter((v) => !invitedIds.has(v.id));

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
            {rfq.dueDate ? ` · due ${new Date(rfq.dueDate).toLocaleDateString()}` : ""}
          </p>
        </div>
        {canUpdate && !isFinalized && (
          <Button variant="outline" onClick={handleClose} disabled={closeRfq.isPending}>
            Close RFQ
          </Button>
        )}
        {rfq.status === "AWARDED" && canCreatePo && (
          <Button onClick={handleCreatePo}>
            <ShoppingCart className="mr-2 h-4 w-4" /> Create Purchase Order
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
          {canUpdate && !isFinalized && (
            <div className="flex gap-2">
              <Select value={inviteVendorId} onValueChange={setInviteVendorId}>
                <SelectTrigger className="max-w-xs">
                  <SelectValue placeholder="Select a vendor to invite" />
                </SelectTrigger>
                <SelectContent>
                  {availableVendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleInvite} disabled={!inviteVendorId || addVendor.isPending}>
                Invite
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items & quotes</CardTitle>
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
                      return (
                        <TableCell key={invite.id}>
                          <QuoteCell
                            initialRate={quote?.rate ?? null}
                            disabled={!canUpdate || isFinalized}
                            onCommit={(rate) =>
                              upsertQuote.mutate({ itemId: item.id, vendorId: invite.vendor.id, input: { rate } })
                            }
                          />
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
                    {total.vendorName} {index === 0 && <Badge className="ml-1">Lowest</Badge>}
                  </div>
                  <p className="text-muted-foreground">
                    Total: {total.total.toLocaleString()} ({total.itemsQuoted} item(s) quoted)
                  </p>
                </div>
              ))}
            </div>

            {canUpdate && !isFinalized && (
              <div className="flex gap-2">
                <Select value={awardVendorId} onValueChange={setAwardVendorId}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue placeholder="Select a vendor to award" />
                  </SelectTrigger>
                  <SelectContent>
                    {rfq.vendorInvites.map((invite) => (
                      <SelectItem key={invite.vendor.id} value={invite.vendor.id}>
                        {invite.vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={handleAward} disabled={!awardVendorId || awardRfq.isPending}>
                  Award RFQ
                </Button>
              </div>
            )}
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
