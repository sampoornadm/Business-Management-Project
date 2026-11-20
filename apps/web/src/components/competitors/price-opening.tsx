"use client";

import type { TenderEvaluationCriteria, TenderStatementDto } from "@bmp/types";
import {
  cn,
  formatDateTime,
  formatMoney,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bmp/ui";
import Link from "next/link";

import { useTenderStanding, useTenderStatement } from "@/hooks/use-competitors";

import { LowestBidderCrown } from "./lowest-bidder-crown";

/**
 * Where we stand after the client opened the price bids: our rank by total and the lowest bidder.
 * The lowest quote is the probable winner, not a confirmed award, and is worded that way.
 */
export function TenderStandingLine({
  tenderId,
  enabled,
  evaluationCriteria,
}: {
  tenderId: string;
  enabled: boolean;
  evaluationCriteria: TenderEvaluationCriteria | null;
}) {
  const standing = useTenderStanding(tenderId, enabled).data;
  if (!standing) return null;
  // Item-wise evaluation: the overall rank decides nothing, so don't present it as the standing.
  if (evaluationCriteria === "INDIVIDUAL") {
    return (
      <p className="mt-2 text-sm">
        <span className="font-medium">Price opening:</span>{" "}
        <span className="text-muted-foreground">
          evaluated item by item, so the overall rank does not decide the order. See the items we could win below.
        </span>
      </p>
    );
  }
  const { lowest } = standing;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span className="font-medium">Price opening:</span>
      {standing.ourRank !== null ? (
        <span>
          we are <span className="font-semibold">L{standing.ourRank}</span> of {standing.bidders} at{" "}
          <span className="tabular-nums">{formatMoney(standing.ourTotal)}</span>
        </span>
      ) : standing.usIdentified ? (
        <span>our bid does not cover every item, so it has no overall rank</span>
      ) : (
        <span>
          our bid is not identified.{" "}
          <Link href="/competitors" className="underline">
            Mark our firm
          </Link>
        </span>
      )}
      {lowest && !lowest.isSelf && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          · <LowestBidderCrown /> L1{" "}
          <Link href={`/competitors/${lowest.competitorId}`} className="text-foreground hover:underline">
            {lowest.name}
          </Link>{" "}
          at <span className="tabular-nums">{formatMoney(lowest.total)}</span> (probable winner)
        </span>
      )}
      {lowest?.isSelf && (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          · <LowestBidderCrown /> ours is the lowest quote
        </span>
      )}
    </p>
  );
}

// Left offsets of the three columns that stay put while the competitors scroll sideways.
const STICKY = {
  serial: "sticky left-0 z-10 w-14 min-w-14 bg-background",
  item: "sticky left-14 z-10 w-64 min-w-64 bg-background",
  us: "sticky left-[19.5rem] z-10 w-36 min-w-36 border-r bg-background",
};

/** Items where our quote is the lowest (or tied for it): the ones an item-wise order can come to us for. */
function winnableItems(statement: TenderStatementDto, ourId: string) {
  return statement.items.flatMap((item) => {
    const ourRate = item.rates[ourId];
    if (ourRate === undefined) return [];
    const others = Object.entries(item.rates)
      .filter(([id]) => id !== ourId)
      .map(([, rate]) => rate);
    const nextBest = others.length ? Math.min(...others) : null;
    if (nextBest !== null && nextBest < ourRate) return [];
    return [{ item, ourRate, nextBest, tied: nextBest === ourRate }];
  });
}

/** Item codes we are the lowest (or tied lowest) quote on; empty when our bid is not identified. */
export function lowestItemCodes(statement: TenderStatementDto): Set<string> {
  const us = statement.bidders.find((bidder) => bidder.isSelf);
  if (!us) return new Set();
  return new Set(winnableItems(statement, us.competitorId).map(({ item }) => item.itemCode));
}

/** Individual-evaluation tenders only: which items we are lowest on, so which orders could come to us. */
function WinnableItems({ statement }: { statement: TenderStatementDto }) {
  const us = statement.bidders.find((bidder) => bidder.isSelf);
  if (!us) {
    return (
      <p className="rounded-lg border p-3 text-sm text-muted-foreground">
        Our bid is not identified in this statement, so we cannot tell which items we could win.{" "}
        <Link href="/competitors" className="underline">
          Mark our firm
        </Link>
      </p>
    );
  }
  const winnable = winnableItems(statement, us.competitorId);
  const quoted = statement.items.filter((item) => item.rates[us.competitorId] !== undefined).length;
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Items we could win</h3>
        <p className="text-xs text-muted-foreground">
          Evaluated item by item · lowest on {winnable.length} of {quoted} items we quoted
        </p>
      </div>
      {winnable.length === 0 ? (
        <p className="text-sm text-muted-foreground">We are not the lowest bidder on any item.</p>
      ) : (
        <ul className="divide-y text-sm">
          {winnable.map(({ item, ourRate, nextBest, tied }) => (
            <li key={`${item.slNo}-${item.itemCode}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-1.5">
              <span>
                <span className="tabular-nums text-muted-foreground">{item.slNo}</span>{" "}
                <span className="font-medium">{item.description || item.itemCode}</span>
                {item.quantity !== null && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {item.quantity.toLocaleString("en-IN")} {item.unit ?? ""}
                  </span>
                )}
              </span>
              <span className="tabular-nums">
                <span className="font-medium text-success">{formatMoney(ourRate)}</span>
                <span className="text-muted-foreground">
                  {nextBest === null
                    ? " · no other bidder"
                    : tied
                      ? " · tied for lowest"
                      : ` · next lowest ${formatMoney(nextBest)} (${(((nextBest - ourRate) / nextBest) * 100).toFixed(1)}% below)`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function rankIn(rates: Record<string, number>, competitorId: string): number | null {
  const own = rates[competitorId];
  if (own === undefined) return null;
  return 1 + Object.values(rates).filter((rate) => rate < own).length;
}

/**
 * The price opening as one table: items in the tender's own order, our bid fixed straight after
 * the item, every competitor to the right of it (that part scrolls sideways).
 */
export function PriceOpeningTable({
  tenderId,
  enabled,
  evaluationCriteria,
}: {
  tenderId: string;
  enabled: boolean;
  evaluationCriteria: TenderEvaluationCriteria | null;
}) {
  const query = useTenderStatement(tenderId, enabled);
  if (!enabled) return null;
  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  const statement: TenderStatementDto | null | undefined = query.data;
  if (!statement) return null;

  const us = statement.bidders.find((bidder) => bidder.isSelf);
  const others = statement.bidders.filter((bidder) => !bidder.isSelf);

  return (
    <div className="space-y-3">
      {evaluationCriteria === "INDIVIDUAL" && <WinnableItems statement={statement} />}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Price opening</h3>
        <p className="text-xs text-muted-foreground">
          Basic rate per unit, before GST · read from the portal {formatDateTime(statement.fetchedAt)}
        </p>
      </div>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className={STICKY.serial}>Item no.</TableHead>
              <TableHead className={STICKY.item}>Item</TableHead>
              <TableHead className={cn(STICKY.us, "text-right")}>
                <span className="inline-flex items-center gap-1.5">
                  {us?.lowestOverall && <LowestBidderCrown />}
                  Us
                </span>
                <div className="text-xs font-normal text-muted-foreground">
                  {us ? (us.rank !== null ? `L${us.rank} overall` : "Partial bid") : "Not identified"}
                </div>
              </TableHead>
              {others.map((bidder) => (
                <TableHead key={bidder.competitorId} className="min-w-40 text-right align-top">
                  <span className="inline-flex items-center gap-1.5">
                    {bidder.lowestOverall && <LowestBidderCrown />}
                    <Link href={`/competitors/${bidder.competitorId}`} className="hover:underline">
                      {bidder.name}
                    </Link>
                  </span>
                  <div className="text-xs font-normal text-muted-foreground">
                    {bidder.rank !== null ? `L${bidder.rank} overall` : "Partial bid"}
                    {bidder.deliveryText ? ` · delivery ${bidder.deliveryText}` : ""}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {statement.items.map((item) => {
              const lowest = Math.min(...Object.values(item.rates));
              const ourRate = us ? item.rates[us.competitorId] : undefined;
              const ourRank = us ? rankIn(item.rates, us.competitorId) : null;
              return (
                <TableRow key={`${item.slNo}-${item.itemCode}`}>
                  <TableCell className={cn(STICKY.serial, "tabular-nums")}>{item.slNo}</TableCell>
                  <TableCell className={STICKY.item}>
                    <Link href={`/competitors/items/${encodeURIComponent(item.itemCode)}`} className="hover:underline">
                      {item.description || item.itemCode}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {item.itemCode}
                      {item.quantity !== null && ` · ${item.quantity.toLocaleString("en-IN")} ${item.unit ?? ""}`}
                    </div>
                  </TableCell>
                  <TableCell className={cn(STICKY.us, "text-right tabular-nums")}>
                    {ourRate === undefined ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <>
                        <span className={cn("font-medium", ourRate === lowest && "text-success")}>
                          {formatMoney(ourRate)}
                        </span>
                        <div className="text-xs text-muted-foreground">L{ourRank}</div>
                      </>
                    )}
                  </TableCell>
                  {others.map((bidder) => {
                    const rate = item.rates[bidder.competitorId];
                    return (
                      <TableCell key={bidder.competitorId} className="text-right tabular-nums">
                        {rate === undefined ? (
                          <span className="text-muted-foreground" title="Did not quote this item">
                            —
                          </span>
                        ) : (
                          <span className={cn(rate === lowest && "font-medium text-success")}>{formatMoney(rate)}</span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/40 font-medium">
              <TableCell className={cn(STICKY.serial, "bg-muted")} />
              <TableCell className={cn(STICKY.item, "bg-muted")}>Total quote</TableCell>
              <TableCell className={cn(STICKY.us, "bg-muted text-right tabular-nums")}>
                {formatMoney(us?.total ?? null)}
              </TableCell>
              {others.map((bidder) => (
                <TableCell key={bidder.competitorId} className="text-right tabular-nums">
                  {formatMoney(bidder.total)}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Green is the lowest rate for that item. The crown marks the lowest total quote, the probable winner; it is not a
        confirmed award.
      </p>
    </div>
  );
}
