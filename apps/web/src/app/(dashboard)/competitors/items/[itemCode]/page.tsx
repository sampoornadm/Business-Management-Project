"use client";

import {
  Badge,
  cn,
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
} from "@bmp/ui";
import { Swords } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { LowestBidderCrown } from "@/components/competitors/lowest-bidder-crown";
import { PredictedRate, TrendLabel } from "@/components/competitors/trend-label";
import { useItemComparison } from "@/hooks/use-competitors";

// Tender, date and our own rate stay put while the competitors scroll sideways.
const FIXED = {
  tender: "sticky left-0 z-10 w-32 min-w-32 bg-background",
  opened: "sticky left-32 z-10 w-28 min-w-28 bg-background",
  us: "sticky left-60 z-10 w-32 min-w-32 border-r bg-background",
};

export default function ItemComparisonPage() {
  const params = useParams<{ itemCode: string }>();
  const itemCode = decodeURIComponent(params.itemCode);
  const comparisonQuery = useItemComparison(itemCode);

  if (comparisonQuery.isLoading) return <PageSkeleton />;
  const comparison = comparisonQuery.data;
  const back = (
    <Link href="/competitors" className="hover:underline">
      Competitors
    </Link>
  );
  if (!comparison) {
    return (
      <div className="space-y-6">
        <PageHeader title={itemCode} back={back} />
        <EmptyState icon={Swords} title="No competitor has quoted this item" description="Rates appear here after a tender with this item is marked Won or Lost." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={comparison.description || comparison.itemCode}
        back={back}
        badges={<Badge variant="outline">Item {comparison.itemCode}</Badge>}
        description={`Basic rate per ${comparison.unit ?? "unit"}, before GST. One row per tender, newest first.`}
      />
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={FIXED.tender}>Tender</TableHead>
              <TableHead className={FIXED.opened}>Opened</TableHead>
              {comparison.columns.map((column) => (
                <TableHead key={column.competitorId} className={cn("text-right", column.isSelf && FIXED.us)}>
                  {column.isSelf ? (
                    "Us"
                  ) : (
                    <Link href={`/competitors/${column.competitorId}`} className="hover:underline">
                      {column.name}
                    </Link>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {comparison.rows.map((row) => {
              const lowest = Math.min(...Object.values(row.rates));
              return (
                <TableRow key={row.tenderId}>
                  <TableCell className={FIXED.tender}>
                    <Link href={`/tenders/${row.tenderId}`} className="hover:underline">
                      {row.tenderNumber}
                    </Link>
                  </TableCell>
                  <TableCell className={FIXED.opened}>{formatDate(row.openedAt)}</TableCell>
                  {comparison.columns.map((column) => {
                    const rate = row.rates[column.competitorId];
                    return (
                      <TableCell
                        key={column.competitorId}
                        className={cn("text-right tabular-nums", column.isSelf && FIXED.us)}
                      >
                        {rate === undefined ? (
                          <span className="text-muted-foreground" title="Did not bid">
                            —
                          </span>
                        ) : (
                          <span className={cn("inline-flex items-center gap-1.5", rate === lowest && "font-medium text-success")}>
                            {row.lowestOverallCompetitorId === column.competitorId && <LowestBidderCrown />}
                            {formatMoney(rate)}
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/40">
              <TableCell className={cn(FIXED.tender, "font-medium")}>Predicted next</TableCell>
              <TableCell className={cn(FIXED.opened, "text-muted-foreground")}>From trend</TableCell>
              {comparison.columns.map((column) => (
                <TableCell key={column.competitorId} className={cn("text-right", column.isSelf && FIXED.us)}>
                  <PredictedRate forecast={column.forecast} />
                  <div className="text-xs text-muted-foreground">
                    <TrendLabel forecast={column.forecast} />
                  </div>
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p className="text-sm text-muted-foreground">
        Green is the lowest rate for this item in that tender. The crown marks the lowest overall bidder of the
        tender, which is not always who was awarded the order. A dash means the firm did not bid.
      </p>
    </div>
  );
}
