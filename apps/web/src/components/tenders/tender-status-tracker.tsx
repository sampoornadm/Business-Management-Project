"use client";

import {
  isTenderStatusReversal,
  TENDER_STATUS_LABELS,
  type ChangeTenderStatusInput,
  type TenderDto,
  type TenderStatus,
} from "@bmp/types";
import {
  Button,
  cn,
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

import { useCurrentBoq } from "@/hooks/use-boq";
import { useChangeTenderStatus, useTenderStatusHistory } from "@/hooks/use-tenders";
import { canRevertTo } from "@/lib/tender-stepper";

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
      <span className={cn(labelClass, hoverLabel && "group-hover:hidden")}>{label}</span>
      {hoverLabel && <span className="hidden font-medium text-primary group-hover:inline">{hoverLabel}</span>}
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
}

/**
 * Draft -> Submitted -> Result. Clicking the next stage moves the tender on; at Submitted the
 * Result circle opens into a Won / Lost / Cancelled band that collapses into the pick. Only
 * `canRevert` (admins) can click an earlier stage to move back; anyone gets a short Undo.
 */
export function TenderStatusTracker({ tender, canChange, canRevert, canViewBoq }: TenderStatusTrackerProps) {
  const { toast } = useToast();
  const changeStatus = useChangeTenderStatus(tender.id);
  const status = tender.status;
  const [bandOpen, setBandOpen] = useState(false);
  const [committing, setCommitting] = useState<Outcome | null>(null);
  const [formFor, setFormFor] = useState<TenderStatus | null>(null);

  // Reset the band once the new status lands. The Result slot keeps the same elements across
  // Submitted -> outcome, so the picked circle stays put while the others finish collapsing.
  const [prevStatus, setPrevStatus] = useState(status);
  if (status !== prevStatus) {
    setPrevStatus(status);
    setBandOpen(false);
    setCommitting(null);
    setFormFor(null);
  }

  // A cancelled tender may never have been submitted; only its latest history row says so.
  const history = useTenderStatusHistory(status === "CANCELLED" ? tender.id : undefined, 1, 1);
  const submittedSkipped = status === "CANCELLED" && history.data?.items[0]?.fromStatus === "DRAFT";
  const reachedSubmitted = status !== "DRAFT" && !submittedSkipped;
  const boq = useCurrentBoq(canViewBoq && status === "SUBMITTED" ? tender.id : undefined);
  const itemsTotal = boq.data?.totalAmount ? Math.round(boq.data.totalAmount * 100) / 100 : undefined;

  const busy = changeStatus.isPending || committing !== null;

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
      <Stage {...NEXT} label="Submitted" hoverLabel="Mark Submitted →" onClick={busy ? undefined : () => void move("SUBMITTED")} />
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

  const canOpenBand = status === "SUBMITTED" && canChange && !busy;
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
            label={TENDER_STATUS_LABELS[outcome.status]}
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
        <div className="inline-flex flex-wrap items-center">
          {draftStage}
          <Connector done={reachedSubmitted} />
          {submittedStage}
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
      <PopoverContent className="w-72">
        {formFor && (
          <form onSubmit={submitForm} className="space-y-3 text-sm">
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
            {(formFor === "WON" || formFor === "LOST") && (
              <>
                <div className="space-y-1">
                  <Label htmlFor="tracker-winner">Winner</Label>
                  <Input
                    id="tracker-winner"
                    name="winnerName"
                    defaultValue={formFor === "WON" ? "Us" : ""}
                    placeholder="Winning bidder"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="tracker-amount">Winning bid amount</Label>
                  <Input
                    id="tracker-amount"
                    name="winningBidAmount"
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={formFor === "WON" ? itemsTotal : undefined}
                  />
                  {formFor === "WON" && itemsTotal !== undefined && (
                    <p className="text-xs text-muted-foreground">Filled in from the Items total.</p>
                  )}
                </div>
              </>
            )}
            {formFor === "LOST" && (
              <div className="space-y-1">
                <Label htmlFor="tracker-loss-reason">Reason lost</Label>
                <Input id="tracker-loss-reason" name="lossReason" placeholder="e.g. L2 by 1.8%" />
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
