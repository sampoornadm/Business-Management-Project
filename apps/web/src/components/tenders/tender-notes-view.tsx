"use client";

import { Loader2, Pin } from "lucide-react";
import type { ReactNode } from "react";

interface TenderNotesViewProps {
  notes: string;
  pinnedLineTexts?: Set<string>;
  onTogglePin?: (lineText: string) => void;
  pendingLineText?: string | null;
}

// Minimal renderer for the markdown-ish Terms & Notes string: "## "/"# " headers render as
// plain labels, every other non-blank line renders as a bullet point regardless of how it's
// marked in the source text (or isn't). Deliberately not a full markdown lib.
export function TenderNotesView({
  notes,
  pinnedLineTexts,
  onTogglePin,
  pendingLineText,
}: TenderNotesViewProps) {
  return (
    <div className="space-y-1 text-sm">
      {notes.split("\n").map((line, index) => {
        const trimmed = line.trim();
        const key = `${index}-${trimmed.slice(0, 12)}`;
        if (!trimmed) return <div key={key} className="h-1.5" />;
        if (trimmed.startsWith("## ")) {
          return (
            <p key={key} className="mt-3 font-medium first:mt-0">
              {trimmed.slice(3)}
            </p>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <p key={key} className="mt-3 font-semibold first:mt-0">
              {trimmed.slice(2)}
            </p>
          );
        }
        // Every other non-empty, non-header line is a point — whether it already carries a
        // "- "/"* " marker (AI-cleaned notes), a "1."/"i." prefix (numbered ITT clauses, which
        // cleanupNotes deliberately leaves un-dashed — see tender-extraction.service.ts), or no
        // marker at all (freehand text typed into the Notes field). `lineText` (the pin key)
        // stays exactly the "- "/"* " marker stripped for the first case, and the untouched line
        // otherwise, so it keeps matching rows already pinned under the old un-bulleted rendering.
        const hasBulletMarker = trimmed.startsWith("- ") || trimmed.startsWith("* ");
        const lineText = hasBulletMarker ? trimmed.slice(2) : trimmed;
        return (
          <PinnableLine
            key={key}
            lineText={lineText}
            pinnedLineTexts={pinnedLineTexts}
            onTogglePin={onTogglePin}
            pendingLineText={pendingLineText}
          >
            <div className="flex gap-2 pl-1">
              <span className="text-muted-foreground">•</span>
              <span>{lineText}</span>
            </div>
          </PinnableLine>
        );
      })}
    </div>
  );
}

function PinnableLine({
  lineText,
  pinnedLineTexts,
  onTogglePin,
  pendingLineText,
  children,
}: {
  lineText: string;
  pinnedLineTexts?: Set<string>;
  onTogglePin?: (lineText: string) => void;
  pendingLineText?: string | null;
  children: ReactNode;
}) {
  if (!onTogglePin) return <>{children}</>;

  const isPinned = pinnedLineTexts?.has(lineText) ?? false;
  const isPending = pendingLineText === lineText;

  return (
    <div className="group relative flex items-center gap-1">
      <button
        type="button"
        onClick={() => onTogglePin(lineText)}
        disabled={isPending}
        title={isPinned ? "Click to unpin" : "Click to pin"}
        className={`shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground ${
          isPinned || isPending ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        {isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Pin className="h-3.5 w-3.5" fill={isPinned ? "currentColor" : "none"} />
        )}
      </button>
      <div className="flex-1">{children}</div>
    </div>
  );
}
