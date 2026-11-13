"use client";

import { DropdownMenuItem, useToast } from "@bmp/ui";
import { Loader2, Table2 } from "lucide-react";

import { useFetchComparativeStatement } from "@/hooks/use-competitors";

/**
 * Fetches a won/lost tender's comparative statement and reports the outcome as toasts. It runs on
 * its own after the status change has been saved, so a closed or logged-out portal can never hold
 * that change up; the user can always retry from the tender's More menu.
 */
export function useFetchStatementAction(tenderId: string) {
  const { toast } = useToast();
  const fetchStatement = useFetchComparativeStatement(tenderId);

  async function run() {
    toast({
      title: "Fetching comparative statement…",
      description: "Opening it in the portal browser window.",
    });
    try {
      const result = await fetchStatement.mutateAsync();
      toast({
        title: `Comparative statement saved: ${result.bidders} bidders, ${result.items} ${result.items === 1 ? "item" : "items"}`,
        description: [
          result.lowestBidder ? `Lowest overall bidder: ${result.lowestBidder}.` : null,
          result.usFound ? null : "Our own bid was not recognised. Mark our firm on the Competitors page.",
        ]
          .filter(Boolean)
          .join(" "),
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Comparative statement not saved",
        description: `${error instanceof Error ? error.message : "Please try again."} You can retry from More → Fetch comparative statement.`,
      });
    }
  }

  return { run, isPending: fetchStatement.isPending };
}

export function FetchStatementMenuItem({ tenderId }: { tenderId: string }) {
  const { run, isPending } = useFetchStatementAction(tenderId);
  return (
    <DropdownMenuItem disabled={isPending} onSelect={() => void run()}>
      {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Table2 className="mr-2 h-4 w-4" />}
      {isPending ? "Fetching…" : "Fetch comparative statement"}
    </DropdownMenuItem>
  );
}
