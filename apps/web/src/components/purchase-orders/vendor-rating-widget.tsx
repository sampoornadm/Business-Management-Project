"use client";

import type { VendorRatingSummaryDto } from "@bmp/types";
import { Button, cn, Textarea, useToast } from "@bmp/ui";
import { Star } from "lucide-react";
import { useState } from "react";

import { useUpsertVendorRating } from "@/hooks/use-purchase-orders";

export function VendorRatingWidget({
  purchaseOrderId,
  existingRating,
}: {
  purchaseOrderId: string;
  existingRating: VendorRatingSummaryDto | null;
}) {
  const { toast } = useToast();
  const upsertRating = useUpsertVendorRating(purchaseOrderId);
  const [rating, setRating] = useState(existingRating?.rating ?? 0);
  const [remarks, setRemarks] = useState(existingRating?.remarks ?? "");

  async function handleSubmit() {
    if (rating < 1) {
      toast({ variant: "destructive", title: "Select a rating" });
      return;
    }
    try {
      await upsertRating.mutateAsync({ rating, remarks: remarks || undefined });
      toast({ title: "Vendor rated" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not rate vendor",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} type="button" onClick={() => setRating(value)} aria-label={`Rate ${value} stars`}>
            <Star
              className={cn(
                "h-6 w-6",
                value <= rating ? "fill-current text-amber-500" : "text-muted-foreground",
              )}
            />
          </button>
        ))}
      </div>
      <Textarea
        rows={2}
        placeholder="Remarks (optional)"
        value={remarks}
        onChange={(e) => setRemarks(e.target.value)}
      />
      <Button size="sm" onClick={handleSubmit} disabled={upsertRating.isPending}>
        {existingRating ? "Update rating" : "Submit rating"}
      </Button>
    </div>
  );
}
