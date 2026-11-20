"use client";

import type { CompetitorItemDto } from "@bmp/types";
import {
  Badge,
  Button,
  confirmAction,
  EmptyState,
  formatDate,
  formatMoney,
  PageHeader,
  PageSkeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bmp/ui";
import { ChevronDown, ChevronRight, Swords } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { LowestBidderCrown } from "@/components/competitors/lowest-bidder-crown";
import { PredictedRate, TrendLabel } from "@/components/competitors/trend-label";
import { useCompetitor, useSetCompetitorSelf } from "@/hooks/use-competitors";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

function ItemRates({ item, isSelf, defaultOpen }: { item: CompetitorItemDto; isSelf: boolean; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-left text-sm hover:bg-muted/50"
      >
        <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">{item.description || item.itemCode}</span>
        <span className="text-muted-foreground">
          {item.rates.length} {item.rates.length === 1 ? "tender" : "tenders"}
        </span>
        <TrendLabel forecast={item.forecast} className="text-muted-foreground" />
        <span className="text-muted-foreground">
          {item.forecast.predictedRate === null ? (
            "Not enough history to predict"
          ) : (
            <>
              Predicted next <PredictedRate forecast={item.forecast} className="text-foreground" />
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tender</TableHead>
                <TableHead>Opened</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Basic rate</TableHead>
                {!isSelf && <TableHead className="text-right">Our rate</TableHead>}
                <TableHead>Rank</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {item.rates.map((rate) => (
                <TableRow key={rate.tenderId}>
                  <TableCell>
                    <Link href={`/tenders/${rate.tenderId}`} className="hover:underline">
                      {rate.tenderNumber}
                    </Link>
                  </TableCell>
                  <TableCell>{formatDate(rate.openedAt)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate.quantity === null ? "—" : rate.quantity.toLocaleString("en-IN")}
                    {rate.quantity !== null && item.unit ? ` ${item.unit}` : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(rate.basicRate)}</TableCell>
                  {!isSelf && <TableCell className="text-right tabular-nums">{formatMoney(rate.ourRate)}</TableCell>}
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5">
                      L{rate.rank} of {rate.bidders}
                      {rate.lowestOverall && <LowestBidderCrown />}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function CompetitorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const competitorQuery = useCompetitor(id);
  const setSelf = useSetCompetitorSelf(id);

  if (competitorQuery.isLoading) return <PageSkeleton />;
  const competitor = competitorQuery.data;
  if (!competitor) {
    return <EmptyState icon={Swords} title="Competitor not found" description="It may belong to another business." />;
  }

  async function toggleSelf(isSelf: boolean, name: string) {
    const confirmed = await confirmAction({
      title: isSelf ? `Mark ${name} as our firm?` : `Unmark ${name} as our firm?`,
      description: isSelf
        ? "Its bids will be shown as “Us” and left out of the rates to beat."
        : "Its bids will be treated as a competitor's again.",
      confirmLabel: isSelf ? "Mark as our firm" : "Unmark our firm",
    });
    if (!confirmed) return;
    try {
      await setSelf.mutateAsync(isSelf);
      toast({ title: isSelf ? "Marked as our firm" : "No longer marked as our firm" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update competitor",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={competitor.name}
        back={
          <Link href="/competitors" className="hover:underline">
            Competitors
          </Link>
        }
        badges={
          <>
            {competitor.isSelf && <Badge variant="secondary">Us</Badge>}
            <Badge variant="outline">SAIL vendor {competitor.vendorCode}</Badge>
            {competitor.mseStatus && <Badge variant="outline">{competitor.mseStatus}</Badge>}
          </>
        }
        description={`Met in ${competitor.tenderCount} ${competitor.tenderCount === 1 ? "tender" : "tenders"} · lowest overall bidder in ${competitor.lowestCount} · last seen ${formatDate(competitor.lastSeenAt)}`}
        actions={
          hasPermission(roleName, "tenders:fill_portal") && (
            <Button
              variant="outline"
              disabled={setSelf.isPending}
              onClick={() => void toggleSelf(!competitor.isSelf, competitor.name)}
            >
              {competitor.isSelf ? "Unmark our firm" : "Mark as our firm"}
            </Button>
          )
        }
      />
      {competitor.items.length === 0 ? (
        <EmptyState icon={Swords} title="No item rates" description="This bidder has not quoted an item in a saved statement." />
      ) : (
        <div className="space-y-3">
          {competitor.items.map((item, index) => (
            <ItemRates key={item.itemCode} item={item} isSelf={competitor.isSelf} defaultOpen={index === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
