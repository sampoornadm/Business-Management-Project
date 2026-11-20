import { cn } from "@bmp/ui";
import { Crown } from "lucide-react";

/**
 * Marks the lowest overall quote in a tender. The portal's statement shows quotes, not who was
 * awarded the order, so this never says "winner".
 */
export function LowestBidderCrown({ className }: { className?: string }) {
  return (
    <span role="img" aria-label="Lowest overall bidder" title="Lowest overall bidder" className="inline-flex">
      <Crown className={cn("h-3.5 w-3.5 text-signal", className)} aria-hidden />
    </span>
  );
}
