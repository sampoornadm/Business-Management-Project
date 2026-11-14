"use client";

import type {
  LikelyBidderDto,
  RateToBeatDto,
  TenderRatesToBeatDto,
} from "@bmp/types";
import {
  Badge,
  Button,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  formatDate,
  formatMoney,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@bmp/ui";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PredictedRate, TrendLabel } from "./trend-label";

function BidderRow({
  bidder,
  us = false,
}: {
  bidder: LikelyBidderDto;
  us?: boolean;
}) {
  return (
    <TableRow className={cn(us && "bg-primary/5 font-medium")}>
      <TableCell>
        {us ? (
          "Us"
        ) : (
          <Link
            href={`/competitors/${bidder.competitorId}`}
            className="hover:underline"
          >
            {bidder.name}
          </Link>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatMoney(bidder.lastRate)}
      </TableCell>
      <TableCell>
        {bidder.lastTenderNumber} · {formatDate(bidder.lastOpenedAt)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {bidder.tenders}
      </TableCell>
      <TableCell>
        <TrendLabel forecast={bidder.forecast} />
      </TableCell>
      <TableCell className="text-right">
        <PredictedRate forecast={bidder.forecast} />
      </TableCell>
    </TableRow>
  );
}

/**
 * Under our rate in the BOQ grid: the lowest rate a likely bidder is expected to quote for this
 * item, from past comparative statements. Red when our rate is above it, green when at or below.
 * Clicking it lists the likely bidders. Renders nothing for an item with no item code on record.
 */
export function RateToBeatHint({
  entry,
  ourRate,
  description,
}: {
  entry: RateToBeatDto | undefined;
  ourRate: number | null;
  description: string;
}) {
  const [open, setOpen] = useState(false);
  if (!entry) return null;
  if (entry.rateToBeat === null)
    return (
      <span className="block text-xs text-muted-foreground">no history</span>
    );

  const tone =
    ourRate === null
      ? "text-muted-foreground"
      : ourRate > entry.rateToBeat
        ? "text-destructive"
        : "text-success";
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show competitor rates for this item"
        className={cn(
          "ml-auto flex items-center gap-0.5 text-xs tabular-nums hover:underline",
          tone,
        )}
      >
        beat {formatMoney(entry.rateToBeat)}
        <ChevronDown className="h-3 w-3" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{description}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Item {entry.itemCode}</Badge>
                <span>
                  Basic rates per unit, before GST, from past comparative
                  statements.
                </span>
              </div>
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Likely bidder</TableHead>
                  <TableHead className="text-right">Last rate</TableHead>
                  <TableHead>Last tender</TableHead>
                  <TableHead className="text-right">Tenders</TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead className="text-right">Predicted next</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entry.bidders.map((bidder) => (
                  <BidderRow key={bidder.competitorId} bidder={bidder} />
                ))}
                {entry.us && <BidderRow bidder={entry.us} us />}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-muted-foreground">
            Rate to beat {formatMoney(entry.rateToBeat)} = lowest predicted next
            rate among likely bidders (their last rate where there is too little
            history to predict).
          </p>
          <DialogFooter>
            <Button variant="outline" asChild>
              <Link
                href={`/competitors/items/${encodeURIComponent(entry.itemCode)}`}
              >
                Open in Competitors
              </Link>
            </Button>
            <DialogClose asChild>
              <Button>Close</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Who has quoted this tender's items before, most items first. */
export function LikelyBiddersLine({
  rates,
}: {
  rates: TenderRatesToBeatDto | undefined;
}) {
  const bidders = rates?.likelyBidders.slice(0, 5) ?? [];
  if (!rates || bidders.length === 0) return null;
  return (
    <div className="space-y-1">
      {!rates.ourFirmKnown && <OurFirmUnknownNotice />}
      <p className="text-sm text-muted-foreground">
        Likely bidders:{" "}
        {bidders.map((bidder, index) => (
          <span key={bidder.competitorId}>
            {index > 0 && ", "}
            <Link
              href={`/competitors/${bidder.competitorId}`}
              className="text-foreground hover:underline"
            >
              {bidder.name}
            </Link>{" "}
            ({bidder.itemsQuoted} {bidder.itemsQuoted === 1 ? "item" : "items"})
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * Shown while no portal vendor is marked as our own firm: until then our own past bids count as
 * a competitor's, so a "rate to beat" may be our own rate.
 */
export function OurFirmUnknownNotice() {
  return (
    <p
      role="status"
      className="rounded-md border border-signal/40 bg-signal/10 px-3 py-2 text-sm"
    >
      Our own firm is not marked yet, so our past bids are being counted as a
      competitor&apos;s. Open it on the{" "}
      <Link href="/competitors" className="font-medium underline">
        Competitors
      </Link>{" "}
      page and choose “Mark as our firm”.
    </p>
  );
}
