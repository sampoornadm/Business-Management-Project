"use client";

import { TENDER_STATUS_LABELS } from "@bmp/types";
import { Skeleton } from "@bmp/ui";

import { useTenderStatusHistory } from "@/hooks/use-tenders";

export function TenderHistoryTab({ tenderId }: { tenderId: string }) {
  const historyQuery = useTenderStatusHistory(tenderId);

  if (historyQuery.isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  const entries = historyQuery.data?.items ?? [];

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No status changes recorded yet.</p>;
  }

  return (
    <ol className="space-y-3 border-l pl-4">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary" />
          <p className="text-sm">
            {entry.fromStatus ? (
              <>
                <span className="font-medium">{TENDER_STATUS_LABELS[entry.fromStatus]}</span>
                {" → "}
              </>
            ) : null}
            <span className="font-medium">{TENDER_STATUS_LABELS[entry.toStatus]}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {entry.changedBy ? `${entry.changedBy.firstName} ${entry.changedBy.lastName}` : "System"} ·{" "}
            {new Date(entry.changedAt).toLocaleString()}
          </p>
          {entry.remarks && <p className="mt-1 text-sm">{entry.remarks}</p>}
        </li>
      ))}
    </ol>
  );
}
