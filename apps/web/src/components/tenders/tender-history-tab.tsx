"use client";

import { TENDER_STATUS_LABELS, type TenderStatusHistoryEntryDto } from "@bmp/types";
import { Button, formatDateTime, Skeleton } from "@bmp/ui";
import { useState } from "react";

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
            {formatDateTime(entry.changedAt)}
          </p>
          {entry.remarks && <p className="mt-1 text-sm">{entry.remarks}</p>}
          {entry.submission && <SubmissionChanges submission={entry.submission} />}
        </li>
      ))}
    </ol>
  );
}

/** "Submission #N · ref …" with the stored change log behind a toggle. */
function SubmissionChanges({ submission }: { submission: NonNullable<TenderStatusHistoryEntryDto["submission"]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          Submission #{submission.number}
          {submission.reference ? ` · ref ${submission.reference}` : ""}
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setOpen(!open)}>
          {open ? "Hide changes" : "Show changes"}
        </Button>
      </div>
      {open && (
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-sans text-sm">{submission.summary}</pre>
      )}
    </div>
  );
}
