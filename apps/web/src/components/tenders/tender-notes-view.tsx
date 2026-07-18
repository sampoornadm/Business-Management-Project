"use client";

// Minimal renderer for the markdown-ish Terms & Notes string (## headers + "- " points).
// Deliberately not a full markdown lib — the content is only ever headers and bullet lines.
export function TenderNotesView({ notes }: { notes: string }) {
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
          return (
            <div key={key} className="flex gap-2 pl-1">
              <span className="text-muted-foreground">•</span>
              <span>{trimmed.slice(2)}</span>
            </div>
          );
        }
        return (
          <p key={key} className="text-muted-foreground">
            {trimmed}
          </p>
        );
      })}
    </div>
  );
}
