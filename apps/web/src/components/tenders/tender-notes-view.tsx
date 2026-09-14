"use client";

import { Loader2, Pin } from "lucide-react";
import type { ReactNode } from "react";

interface TenderNotesViewProps {
  notes: string;
  pinnedLineTexts?: Set<string>;
  onTogglePin?: (lineText: string) => void;
  pendingLineText?: string | null;
}

// Minimal renderer for the markdown-ish Terms & Notes string (## headers + "- " points).
// Deliberately not a full markdown lib — the content is only ever headers and bullet lines.
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
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          const lineText = trimmed.slice(2);
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
        }
        return (
          <PinnableLine
            key={key}
            lineText={trimmed}
            pinnedLineTexts={pinnedLineTexts}
            onTogglePin={onTogglePin}
            pendingLineText={pendingLineText}
          >
            <p className="text-muted-foreground">{trimmed}</p>
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
