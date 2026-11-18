"use client";

import {
  isSailRfxNumber,
  isTenderStatusReversal,
  TENDER_STATUS_LABELS,
  type ChangeTenderStatusInput,
  type TenderDto,
  type TenderStatus,
} from "@bmp/types";
import {
  Badge,
  Button,
  Checkbox,
  cn,
  formatMoney,
  Input,
  Label,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Textarea,
  ToastAction,
  useToast,
} from "@bmp/ui";
import { Ban, Check, Minus, X } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";

import { useFetchStatementAction } from "@/components/competitors/fetch-statement";
import { useCurrentBoq } from "@/hooks/use-boq";
import { lowestItemCodes } from "@/components/competitors/price-opening";
import { useTenderStanding, useTenderStatement } from "@/hooks/use-competitors";
import { useChangeTenderStatus, useTenderStatusHistory } from "@/hooks/use-tenders";
import { canRevertTo } from "@/lib/tender-stepper";
import { tenderStatusText } from "@/lib/tender-status";
import { boqLeaves } from "@/lib/won-items";

type Outcome = "WON" | "LOST" | "CANCELLED";

const OUTCOMES: { status: Outcome; icon: ReactNode; dot: string; label: string }[] = [
  { status: "WON", icon: <Check className="h-3 w-3" />, dot: "bg-success text-success-foreground", label: "text-success" },
  { status: "LOST", icon: <X className="h-3 w-3" />, dot: "bg-destructive text-destructive-foreground", label: "text-destructive" },
  { status: "CANCELLED", icon: <Minus className="h-3 w-3" />, dot: "bg-muted-foreground text-background", label: "text-muted-foreground" },
];

function isOutcome(status: TenderStatus): status is Outcome {
  return status === "WON" || status === "LOST" || status === "CANCELLED";
}

// Quick start, long settle: reads as one fluid motion rather than a mechanical slide.
const EASE = "ease-[cubic-bezier(0.32,0.72,0,1)]";

/** Animates between zero and natural width via grid 0fr <-> 1fr, so nothing has to be measured. */
function Reveal({ show, delay = 0, children }: { show: boolean; delay?: number; children: ReactNode }) {
  return (
    <span
      inert={!show}
      className={cn(
        "inline-grid transition-[grid-template-columns,opacity] duration-300 motion-reduce:transition-none",
        EASE,
        show ? "grid-cols-[1fr] opacity-100" : "grid-cols-[0fr] opacity-0",
      )}
      style={{ transitionDelay: show ? `${delay}ms` : "0ms" }}
    >
      <span className="flex min-w-0 overflow-hidden">{children}</span>
    </span>
  );
}

interface StageProps {
  dot: ReactNode;
  dotClass: string;
  label: string;
  labelClass?: string;
  hoverLabel?: string;
  title?: string;
  onClick?: () => void;
  className?: string;
}

function Stage({ dot, dotClass, label, labelClass, hoverLabel, title, onClick, className }: StageProps) {
  return (
    <button
      type="button"
      title={title}
      aria-disabled={!onClick}
      onClick={onClick}
      className={cn(
        "group inline-flex items-center gap-1.5 whitespace-nowrap rounded-full py-0.5 pl-0.5 pr-2.5 text-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        onClick ? "hover:bg-muted" : "cursor-default",
        className,
      )}
    >
      <span
        className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors duration-300", dotClass)}
      >
        {dot}
      </span>
      {hoverLabel ? (
        // On hover the label collapses and the hover label opens (grid 0fr <-> 1fr), so the button
        // grows rightward from its fixed left edge in one slow motion instead of snapping.
        <span className="flex">
          <span
            className={cn(
              "grid grid-cols-[1fr] transition-[grid-template-columns,opacity] duration-500 group-hover:grid-cols-[0fr] group-hover:opacity-0 motion-reduce:transition-none",
              EASE,
            )}
          >
            <span className={cn("min-w-0 overflow-hidden", labelClass)}>{label}</span>
          </span>
          <span
            className={cn(
              "grid grid-cols-[0fr] opacity-0 transition-[grid-template-columns,opacity] duration-500 group-hover:grid-cols-[1fr] group-hover:opacity-100 motion-reduce:transition-none",
              EASE,
            )}
          >
            <span className="min-w-0 overflow-hidden font-medium text-primary">{hoverLabel}</span>
          </span>
        </span>
      ) : (
        <span className={labelClass}>{label}</span>
      )}
    </button>
  );
}

function Connector({ done }: { done: boolean }) {
  return (
    <span
      className={cn("h-0.5 w-4 shrink-0 rounded-full transition-colors duration-300", done ? "bg-primary" : "bg-border")}
    />
  );
}

const COMPLETE = { dot: <Check className="h-3 w-3" />, dotClass: "bg-primary text-primary-foreground" };
const CURRENT = {
  dot: <span className="h-1.5 w-1.5 rounded-full bg-primary" />,
  dotClass: "border-2 border-primary bg-background",
  labelClass: "font-semibold",
};
const NEXT = { dot: null, dotClass: "border-2 border-dashed border-primary", labelClass: "text-muted-foreground" };
const UPCOMING = { dot: null, dotClass: "border-2 border-dashed border-border", labelClass: "text-muted-foreground" };
const SKIPPED = { dot: null, dotClass: "border-2 border-border", labelClass: "text-muted-foreground line-through" };

export interface TenderStatusTrackerProps {
  tender: TenderDto;
  canChange: boolean;
  canRevert: boolean;
  canViewBoq: boolean;
  /** May read the client's comparative statement from the portal once the bid is submitted. */
  canFetchStatement?: boolean;
  /** May see where we stand in the price opening (rank, lowest bidder). */
  canViewStanding?: boolean;
}

/**
 * Draft -> Submitted -> Result. Clicking the next stage moves the tender on; at Submitted the
 * Result circle opens into a Won / Lost / Cancelled band that collapses into the pick. Only
 * `canRevert` (admins) can click an earlier stage to move back; anyone gets a short Undo.
 */
export function TenderStatusTracker({
  tender,
  canChange,
  canRevert,
  canViewBoq,
  canFetchStatement = false,
  canViewStanding = false,
}: TenderStatusTrackerProps) {
  const { toast } = useToast();
  const changeStatus = useChangeTenderStatus(tender.id);
  const fetchStatement = useFetchStatementAction(tender.id);
  const status = tender.status;
  const [bandOpen, setBandOpen] = useState(false);
  const [committing, setCommitting] = useState<Outcome | null>(null);
  const [formFor, setFormFor] = useState<TenderStatus | null>(null);
  // Items ticked in the Won form; null until touched, when the lowest-quote items are the default.
  const [pickedItems, setPickedItems] = useState<Set<string> | null>(null);

  // Reset the band once the new status lands. The Result slot keeps the same elements across
  // Submitted -> outcome, so the picked circle stays put while the others finish collapsing.
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    setBandOpen(false);
    setCommitting(null);
    setFormFor(null);
    setPickedItems(null);
  }

  // A cancelled tender may never have been submitted; only its latest history row says so.
  const history = useTenderStatusHistory(status === "CANCELLED" ? tender.id : undefined, 1, 1);
  const submittedSkipped = status === "CANCELLED" && history.data?.items[0]?.fromStatus === "DRAFT";
  const reachedSubmitted = status !== "DRAFT" && !submittedSkipped;
  const awaitingResult = status === "SUBMITTED" || status === "PRICE_OPENED";
  const boq = useCurrentBoq(canViewBoq && awaitingResult ? tender.id : undefined);
  // What the price opening showed: fills in the Won/Lost form and tells whether that stage happened.
  const standing = useTenderStanding(tender.id, canViewStanding && status !== "DRAFT").data ?? null;
  const readsFromPortal = canFetchStatement && isSailRfxNumber(tender.tenderNumber);
  // Item-wise tenders are won item by item: list the lines, our lowest quotes ticked first.
  const individual = tender.evaluationCriteria === "INDIVIDUAL";
  const statement = useTenderStatement(tender.id, individual && canViewStanding && awaitingResult).data ?? null;
  const lowestCodes = statement ? lowestItemCodes(statement) : new Set<string>();
  const wonCandidates = (boq.data ? boqLeaves(boq.data.items) : [])
    .map((item) => ({ item, lowest: item.itemCode !== null && lowestCodes.has(item.itemCode) }))
    .sort((a, b) => Number(b.lowest) - Number(a.lowest));
  const askWonItems = formFor === "WON" && individual && wonCandidates.length > 0;
  const pickedNow = pickedItems ?? new Set(wonCandidates.filter((c) => c.lowest).map((c) => c.item.id));
  const pickedTotal = Math.round(
    wonCandidates.filter((c) => pickedNow.has(c.item.id)).reduce((sum, c) => sum + (c.item.amount ?? 0), 0) * 100,
  ) / 100;
  const itemsTotal = boq.data?.totalAmount ? Math.round(boq.data.totalAmount * 100) / 100 : undefined;

  const busy = changeStatus.isPending || committing !== null || fetchStatement.isPending;
  const ratesFinalized = tender.ratesLockedAt !== null;
  // A fresh submission (not undoing a Won/Lost result) records its reference number.
  const asksReference = formFor === "SUBMITTED" && (status === "DRAFT" || status === "CANCELLED");

  function explainRatesGate() {
    toast({
      title: "Finalize rates first",
      description: "Switch on “Rates finalized” on the Items tab, then mark the tender Submitted.",
    });
  }

  async function move(to: TenderStatus, extra: Omit<ChangeTenderStatusInput, "status"> = {}) {
    const from = status;
    const reversal = isTenderStatusReversal(from, to);
    try {
      await changeStatus.mutateAsync({ status: to, ...extra });
      toast({
        title: reversal ? `Moved back to ${TENDER_STATUS_LABELS[to]}` : `Marked ${TENDER_STATUS_LABELS[to]}`,
        action: reversal ? undefined : (
          <ToastAction altText="Undo" onClick={() => void undo(from)}>
            Undo
          </ToastAction>
        ),
      });
      // The client publishes every bidder's rates once the tender is opened. The status is
      // already saved; this follows on its own and reports through its own toasts.
      // A result recorded straight from Submitted: pick up the statement too, if there is none yet.
      if (readsFromPortal && (to === "WON" || to === "LOST") && !standing) void fetchStatement.run();
    } catch (error) {
      setCommitting(null);
      toast({
        variant: "destructive",
        title: "Could not change status",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  // Not move(): this runs from the toast after a re-render, where move()'s `status` is stale.
  async function undo(back: TenderStatus) {
    try {
      await changeStatus.mutateAsync({ status: back, remarks: "Undo" });
      toast({ title: `Back to ${TENDER_STATUS_LABELS[back]}` });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not undo",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formFor) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => (data.get(name) as string | null)?.trim() || undefined;
    const amount = text("winningBidAmount");
    const to = formFor;
    const wonItemIds = askWonItems && to === "WON" ? [...pickedNow] : undefined;
    setFormFor(null);
    if (bandOpen && isOutcome(to)) {
      setBandOpen(false);
      setCommitting(to);
    }
    void move(to, {
      remarks: text("remarks"),
      winnerName: text("winnerName"),
      winningBidAmount: amount ? Number(amount) : undefined,
      lossReason: text("lossReason"),
      wonItemIds,
      submissionReference: text("submissionReference"),
    });
  }

  function revertProps(target: TenderStatus) {
    if (canRevert && canRevertTo(status, target)) {
      return { title: `Move back to ${TENDER_STATUS_LABELS[target]}`, onClick: busy ? undefined : () => setFormFor(target) };
    }
    return { title: canChange && !canRevert ? "Only admins can move a tender back" : undefined };
  }

  const draftStage =
    status === "DRAFT" ? (
      <Stage {...CURRENT} label="Draft" />
    ) : (
      <Stage {...COMPLETE} label="Draft" {...revertProps("DRAFT")} />
    );

  let submittedStage: ReactNode;
  if (status === "DRAFT") {
    submittedStage = canChange ? (
      <Stage
        {...NEXT}
        label="Submitted"
        hoverLabel={ratesFinalized ? "Mark Submitted →" : "Finalize rates first"}
        title={ratesFinalized ? undefined : "Finalize rates on the Items tab before submitting"}
        onClick={busy ? undefined : ratesFinalized ? () => setFormFor("SUBMITTED") : explainRatesGate}
      />
    ) : (
      <Stage {...UPCOMING} label="Submitted" />
    );
  } else if (status === "SUBMITTED") {
    submittedStage = <Stage {...CURRENT} label="Submitted" />;
  } else if (submittedSkipped) {
    submittedStage = <Stage {...SKIPPED} label="Submitted" {...revertProps("SUBMITTED")} />;
  } else {
    submittedStage = <Stage {...COMPLETE} label="Submitted" {...revertProps("SUBMITTED")} />;
  }

  // For a SAIL ISP tender the stage is reached by reading the comparative statement (the server
  // moves the tender on once it is saved); any other tender is simply marked.
  function openPrices() {
    if (readsFromPortal) void fetchStatement.run();
    else void move("PRICE_OPENED");
  }

  let priceStage: ReactNode;
  if (status === "PRICE_OPENED") {
    priceStage = <Stage {...CURRENT} label="Price opened" />;
  } else if (status === "SUBMITTED" && canChange) {
    priceStage = (
      <Stage
        {...NEXT}
        label="Price opened"
        hoverLabel={readsFromPortal ? "Read price opening →" : "Mark Price opened →"}
        title={readsFromPortal ? "Read the comparative statement from the portal" : undefined}
        onClick={busy ? undefined : openPrices}
      />
    );
  } else if (isOutcome(status) && reachedSubmitted) {
    priceStage = <Stage {...(standing ? COMPLETE : SKIPPED)} label="Price opened" {...revertProps("PRICE_OPENED")} />;
  } else {
    priceStage = <Stage {...UPCOMING} label="Price opened" />;
  }

  // Won/Lost form defaults: what the price opening showed, editable before confirming.
  const probableWinner = standing?.lowest && !standing.lowest.isSelf ? standing.lowest : null;
  const winnerDefault = formFor === "WON" ? "Us" : (probableWinner?.name ?? "");
  const amountDefault =
    formFor === "WON"
      ? askWonItems
        ? pickedTotal
        : (standing?.ourTotal ?? itemsTotal)
      : probableWinner?.total;
  const lossReasonDefault =
    standing?.ourRank != null ? `L${standing.ourRank} of ${standing.bidders} at price opening` : "";

  const canOpenBand = awaitingResult && canChange && !busy;
  const resultStage = (
    <span
      className={cn(
        "inline-flex items-center rounded-full transition-[background-color,padding] duration-300 motion-reduce:transition-none",
        EASE,
        bandOpen && "bg-muted px-1",
      )}
    >
      <Reveal show={!isOutcome(status) && !bandOpen && !committing}>
        <Stage
          {...(canOpenBand ? NEXT : UPCOMING)}
          label="Result"
          title={canOpenBand ? "Record the result" : undefined}
          onClick={canOpenBand ? () => setBandOpen(true) : undefined}
        />
      </Reveal>
      {OUTCOMES.map((outcome, index) => (
        <Reveal
          key={outcome.status}
          show={bandOpen || (committing ? committing === outcome.status : status === outcome.status)}
          delay={index * 40}
        >
          <Stage
            dot={outcome.icon}
            dotClass={outcome.dot}
            label={
              outcome.status === "WON" && tender.wonItems.length > 0
                ? tenderStatusText(tender).replace("Won ·", "Won in")
                : TENDER_STATUS_LABELS[outcome.status]
            }
            labelClass={cn("font-medium", outcome.label)}
            onClick={bandOpen ? () => setFormFor(outcome.status) : undefined}
            className={cn(bandOpen && "hover:bg-background", formFor === outcome.status && "bg-background shadow-sm")}
          />
        </Reveal>
      ))}
      <Reveal show={bandOpen} delay={OUTCOMES.length * 40}>
        <button
          type="button"
          aria-label="Close"
          onClick={() => {
            setBandOpen(false);
            setFormFor(null);
          }}
          className="rounded-full p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </Reveal>
    </span>
  );

  const reverting = formFor !== null && isTenderStatusReversal(status, formFor);

  return (
    <Popover open={formFor !== null} onOpenChange={(open) => !open && setFormFor(null)}>
      <PopoverAnchor asChild>
        <div className="inline-flex flex-nowrap items-center whitespace-nowrap">
          {draftStage}
          <Connector done={reachedSubmitted} />
          {submittedStage}
          <Connector done={status === "PRICE_OPENED" || (isOutcome(status) && reachedSubmitted)} />
          {priceStage}
          <Connector done={isOutcome(status) && reachedSubmitted} />
          {resultStage}
          {status === "DRAFT" && canChange && (
            <>
              <span className="mx-2 h-4 w-px shrink-0 bg-border" />
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:border-destructive/40 hover:bg-destructive/5 hover:text-destructive"
                disabled={busy}
                onClick={() => setFormFor("CANCELLED")}
              >
                <Ban className="h-3.5 w-3.5" />
                Cancel tender
              </Button>
            </>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent className={cn("w-72", askWonItems && "w-96")}>
        {formFor && (
          <form key={formFor} onSubmit={submitForm} className="space-y-3 text-sm">
            <p className="font-medium">
              {reverting
                ? `Move back to ${TENDER_STATUS_LABELS[formFor]}?`
                : formFor === "CANCELLED"
                  ? "Cancel this tender"
                  : `Mark as ${TENDER_STATUS_LABELS[formFor]}`}
            </p>
            {reverting && (
              <p className="text-xs text-muted-foreground">Admins only. Logged in History with your reason.</p>
            )}
            {asksReference && !ratesFinalized && (
              <p className="text-xs text-destructive">Finalize rates on the Items tab before submitting.</p>
            )}
            {asksReference && (
              <div className="space-y-1">
                <Label htmlFor="tracker-submission-reference">
                  Submission reference number{tender.kind === "BUDGETARY" ? " (optional)" : ""}
                </Label>
                <Input
                  id="tracker-submission-reference"
                  name="submissionReference"
                  defaultValue={tender.submissionReference ?? ""}
                  placeholder="e.g. bid / quotation reference"
                  required={tender.kind !== "BUDGETARY"}
                  maxLength={200}
                />
              </div>
            )}
            {askWonItems && (
              <div className="space-y-1">
                <Label>Items we won</Label>
                <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
                  {wonCandidates.map(({ item, lowest }) => (
                    <li key={item.id}>
                      <label className="flex cursor-pointer items-start gap-2 p-2 text-xs hover:bg-muted/50">
                        <Checkbox
                          className="mt-0.5"
                          checked={pickedNow.has(item.id)}
                          onCheckedChange={(on) => {
                            const next = new Set(pickedNow);
                            if (on) next.add(item.id);
                            else next.delete(item.id);
                            setPickedItems(next);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block max-w-[24ch] truncate" title={item.description}>
                            {item.description}
                          </span>
                          {item.rate !== null && (
                            <span className="block truncate text-muted-foreground">
                              {item.quantity !== null && `${item.quantity.toLocaleString("en-IN")} ${item.unit ?? ""} × `}
                              {formatMoney(item.rate)}
                            </span>
                          )}
                        </span>
                        {lowest && <Badge variant="success">Lowest</Badge>}
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {statement ? "Our lowest quotes at the price opening are ticked. " : ""}
                  {pickedNow.size} selected.
                </p>
              </div>
            )}
            {(formFor === "WON" || formFor === "LOST") && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="tracker-winner">Winner</Label>
                  <Input
                    id="tracker-winner"
                    name="winnerName"
                    defaultValue={winnerDefault}
                    placeholder="Winning bidder"
                  />
                  {formFor === "LOST" && probableWinner && (
                    <p className="text-xs text-muted-foreground">
                      Probable winner: the lowest bidder at the price opening. Change it if the order went elsewhere.
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tracker-amount">Winning bid amount</Label>
                  <Input
                    id="tracker-amount"
                    name="winningBidAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    key={askWonItems ? pickedTotal : "amount"}
                    defaultValue={amountDefault}
                  />
                  {formFor === "WON" && amountDefault !== undefined && (
                    <p className="text-xs text-muted-foreground">
                      {askWonItems
                        ? "Total of the ticked items."
                        : standing?.ourTotal != null ? "Our total at the price opening." : "Filled in from the Items total."}
                    </p>
                  )}
                </div>
              </>
            )}
            {formFor === "LOST" && (
              <div className="space-y-1">
                <Label htmlFor="tracker-loss-reason">Reason lost</Label>
                <Input
                  id="tracker-loss-reason"
                  name="lossReason"
                  defaultValue={lossReasonDefault}
                  placeholder="e.g. L2 by 1.8%"
                />
              </div>
            )}
            {formFor !== "LOST" && (
              <div className="space-y-1">
                <Label htmlFor="tracker-remarks">{reverting ? "Reason" : "Remarks (optional)"}</Label>
                <Textarea id="tracker-remarks" name="remarks" rows={2} required={reverting} />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setFormFor(null)}>
                Back
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={askWonItems && formFor === "WON" && pickedNow.size === 0}
                variant={formFor === "LOST" ? "destructive" : formFor === "CANCELLED" ? "secondary" : "default"}
                className={cn(formFor === "WON" && "bg-success text-success-foreground hover:bg-success/90")}
              >
                {reverting ? "Move back" : `Confirm ${TENDER_STATUS_LABELS[formFor]}`}
              </Button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
}
