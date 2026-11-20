"use client";

import type { TenderLinkedBudgetaryDto } from "@bmp/types";
import {
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
  formatDate,
  useToast,
} from "@bmp/ui";
import Link from "next/link";
import { useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { TenderDownloadMenu } from "@/components/tenders/tender-download-menu";
import { useRfqs } from "@/hooks/use-rfq";
import { useTenders, useUpdateTender } from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

/** The RFQs raised for the budgetary quotation: the vendor quotes to go back to for fresh rates. */
function QuotationVendorQuotes({ budgetaryTenderId }: { budgetaryTenderId: string }) {
  const rfqsQuery = useRfqs({ tenderId: budgetaryTenderId, pageSize: 50 });
  const rfqs = rfqsQuery.data?.items ?? [];

  if (rfqsQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading vendor quotes…</p>;
  if (rfqs.length === 0) {
    return <p className="text-sm text-muted-foreground">No vendor quotes were collected for this quotation.</p>;
  }

  return (
    <div>
      <p className="mb-1 text-sm text-muted-foreground">Vendor quotes from this quotation</p>
      <ul className="divide-y rounded-md border text-sm">
        {rfqs.map((rfq) => (
          <li key={rfq.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <Link href={`/rfqs/${rfq.id}`} className="font-medium hover:underline">
              {rfq.title}
            </Link>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>
                {rfq.vendorCount} {rfq.vendorCount === 1 ? "vendor" : "vendors"} · {rfq.itemCount}{" "}
                {rfq.itemCount === 1 ? "item" : "items"}
              </span>
              <StatusBadge status={rfq.status} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Mounted only while picking, so the client's quotation list is not fetched on every tender view. */
function QuotationPicker({ clientId, onPick }: { clientId: string; onPick: (id: string) => void }) {
  const budgetaryQuery = useTenders({ kind: "BUDGETARY", clientId, pageSize: 50 });
  const options = budgetaryQuery.data?.items ?? [];

  if (!budgetaryQuery.isLoading && options.length === 0) {
    return <p className="text-sm text-muted-foreground">This client has no budgetary quotations.</p>;
  }

  return (
    <Select onValueChange={onPick}>
      <SelectTrigger className="max-w-sm">
        <SelectValue placeholder="Choose a budgetary quotation" />
      </SelectTrigger>
      <SelectContent>
        {options.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.tenderNumber} — {item.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function LinkedBudgetaryQuotationCard({
  tenderId,
  clientId,
  convertedFrom,
}: {
  tenderId: string;
  clientId: string;
  convertedFrom: TenderLinkedBudgetaryDto | null;
}) {
  const { toast } = useToast();
  const updateTender = useUpdateTender(tenderId);
  const [picking, setPicking] = useState(false);
  const canReadRfqs = hasPermission(
    useAuthStore((state) => state.user?.role.name),
    "rfq:read",
  );

  async function link(budgetaryTenderId: string | null) {
    try {
      await updateTender.mutateAsync({ convertedFromId: budgetaryTenderId });
      setPicking(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not link the budgetary quotation",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Budgetary quotation</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {picking ? (
            <Button variant="outline" size="sm" onClick={() => setPicking(false)}>
              Cancel
            </Button>
          ) : convertedFrom ? (
            <>
              <Button variant="destructiveOutline" size="sm" onClick={() => void link(null)}>
                Remove link
              </Button>
              <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
                Change quotation
              </Button>
              <TenderDownloadMenu tenderId={convertedFrom.id} tenderNumber={convertedFrom.tenderNumber} size="sm" />
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
              Link quotation
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {picking ? (
          <QuotationPicker clientId={clientId} onPick={(id) => void link(id)} />
        ) : convertedFrom ? (
          <>
            <div>
              <Link href={`/tenders/${convertedFrom.id}`} className="font-medium hover:underline">
                {convertedFrom.tenderNumber}
              </Link>
              <p className="text-sm text-muted-foreground">
                {convertedFrom.title} · updated {formatDate(convertedFrom.updatedAt)}
              </p>
            </div>
            {canReadRfqs && <QuotationVendorQuotes budgetaryTenderId={convertedFrom.id} />}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            None linked. Link one to bring back the vendor quotes collected for it.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
