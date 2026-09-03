"use client";

import type { BoqRateCandidateDto } from "@bmp/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Skeleton,
  useToast,
} from "@bmp/ui";
import type { ReactNode } from "react";
import { useState } from "react";

import { useConfirmRateSource, useRateCandidates } from "@/hooks/use-boq";

/** A short "did we mean one of these?" list for a BOQ item whose rate didn't clear the
 * auto-apply bar — deliberately just a list + a button per row, no form. */
export function RateMatchCandidatesDialog({
  tenderId,
  itemId,
  itemDescription,
  trigger,
}: {
  tenderId: string;
  itemId: string;
  itemDescription: string;
  trigger: ReactNode;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const candidates = useRateCandidates(itemId, open);
  const confirm = useConfirmRateSource(tenderId);

  async function handleUse(candidate: BoqRateCandidateDto) {
    try {
      await confirm.mutateAsync({
        itemId,
        input: {
          override: {
            rateSourceId: candidate.id,
            itemName: candidate.itemName,
            rate: candidate.rate,
            confidence: candidate.similarity,
          },
        },
      });
      toast({ title: "Rate applied" });
      setOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not apply rate",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Possible rate matches</DialogTitle>
        </DialogHeader>
        <div className="min-w-0 rounded-md bg-muted/50 p-3 text-sm">
          <p className="text-xs font-medium uppercase text-muted-foreground">Matching against</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{itemDescription}</p>
        </div>
        <div className="min-w-0 space-y-2">
          {candidates.isLoading && <Skeleton className="h-16 w-full" />}
          {!candidates.isLoading && (candidates.data?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">
              Nothing in your rate history resembles this item closely enough to suggest.
            </p>
          )}
          {candidates.data?.map((candidate) => (
            <div
              key={candidate.id}
              className="flex items-start justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">{candidate.itemName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {candidate.rate.toLocaleString()}/{candidate.unit} ·{" "}
                  {Math.round(candidate.similarity * 100)}% similar
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-0.5 shrink-0"
                onClick={() => void handleUse(candidate)}
                disabled={confirm.isPending}
              >
                Use
              </Button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
