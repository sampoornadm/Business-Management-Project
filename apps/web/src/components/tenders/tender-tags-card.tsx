"use client";

import type { TagDto } from "@bmp/types";
import { Badge, Button, Card, CardContent, Input, Popover, PopoverContent, PopoverTrigger, useToast } from "@bmp/ui";
import { Plus, X } from "lucide-react";
import { useState } from "react";

import { useCreateTag } from "@/hooks/use-tags";

/** One row: the tender's tags as removable chips, plus an "Add tag" popover that searches or creates. */
export function TenderTagsCard({
  allTags,
  selectedTagIds,
  onChange,
  canUpdate,
}: {
  allTags: TagDto[];
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
  canUpdate: boolean;
}) {
  const { toast } = useToast();
  const createTag = useCreateTag();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const trimmed = name.trim();
  const selected = allTags.filter((tag) => selectedTagIds.includes(tag.id));
  const matches = allTags.filter(
    (tag) => !selectedTagIds.includes(tag.id) && tag.name.toLowerCase().includes(trimmed.toLowerCase()),
  );
  // Re-typing an existing tag's name attaches that tag instead of tripping the unique constraint.
  const exact = allTags.find((tag) => tag.name.toLowerCase() === trimmed.toLowerCase());

  function add(tagId: string) {
    if (!selectedTagIds.includes(tagId)) onChange([...selectedTagIds, tagId]);
    setName("");
  }

  async function addTyped() {
    if (!trimmed) return;
    if (exact) return add(exact.id);
    try {
      const tag = await createTag.mutateAsync({ name: trimmed });
      add(tag.id);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create tag",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-2 py-3">
        <span className="mr-1 text-sm font-medium">Tags</span>
        {selected.map((tag) => (
          <Badge key={tag.id} variant="secondary" className="gap-1">
            {tag.name}
            {canUpdate && (
              <button
                type="button"
                aria-label={`Remove tag ${tag.name}`}
                className="rounded-full opacity-60 hover:opacity-100"
                onClick={() => onChange(selectedTagIds.filter((id) => id !== tag.id))}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Badge>
        ))}
        {selected.length === 0 && !canUpdate && <span className="text-sm text-muted-foreground">None</span>}
        {canUpdate && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add tag
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 space-y-2 p-2">
              <Input
                autoFocus
                placeholder="Search or create a tag"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void addTyped();
                  }
                }}
              />
              <div className="max-h-48 overflow-y-auto">
                {matches.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    onClick={() => add(tag.id)}
                  >
                    {tag.name}
                  </button>
                ))}
                {trimmed && !exact && (
                  <button
                    type="button"
                    className="block w-full truncate rounded-sm px-2 py-1.5 text-left text-sm text-primary hover:bg-accent"
                    disabled={createTag.isPending}
                    onClick={() => void addTyped()}
                  >
                    Create “{trimmed}”
                  </button>
                )}
                {matches.length === 0 && !trimmed && (
                  <p className="px-2 py-1.5 text-sm text-muted-foreground">Type a name to create a tag.</p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        )}
      </CardContent>
    </Card>
  );
}
