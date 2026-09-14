"use client";

import type { TenderPinnedNoteDto } from "@bmp/types";
import { Loader2, PinOff } from "lucide-react";

interface PinnedTenderNotesProps {
  pinnedNotes: TenderPinnedNoteDto[];
  onUnpin?: (pinnedNote: TenderPinnedNoteDto) => void;
  pendingLineText?: string | null;
}

// Renders nothing when there's nothing pinned — this section only ever appears once the user
// has pinned at least one line, matching how instructionsLine/metaLine omit themselves elsewhere
// in this codebase's document builders.
export function PinnedTenderNotes({ pinnedNotes, onUnpin, pendingLineText }: PinnedTenderNotesProps) {
  if (pinnedNotes.length === 0) return null;

  return (
    <div className="mb-4 space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
      <p className="font-medium">📌 Pinned</p>
      {pinnedNotes.map((note) => {
        const isPending = pendingLineText === note.lineText;
        return (
          <div key={note.id} className="flex items-start gap-2">
            {onUnpin && (
              <button
                type="button"
                onClick={() => onUnpin(note)}
                disabled={isPending}
                title="Click to unpin"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PinOff className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <span>{note.lineText}</span>
          </div>
        );
      })}
    </div>
  );
}
