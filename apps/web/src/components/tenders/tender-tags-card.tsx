"use client";

import type { TagDto } from "@bmp/types";
import { Button, Card, CardContent, Input, MultiSelect, useToast } from "@bmp/ui";
import { Plus } from "lucide-react";
import { useState } from "react";

import { useCreateTag } from "@/hooks/use-tags";

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
  const [name, setName] = useState("");

  async function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;

    // If a tag with this name already exists, just attach it rather than erroring on the
    // unique constraint — "add custom tag" should be forgiving about re-typing an existing one.
    const existing = allTags.find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      if (!selectedTagIds.includes(existing.id)) onChange([...selectedTagIds, existing.id]);
      setName("");
      return;
    }

    try {
      const tag = await createTag.mutateAsync({ name: trimmed });
      onChange([...selectedTagIds, tag.id]);
      setName("");
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
      <CardContent className="space-y-2 pt-6">
        <p className="text-sm font-medium">Tags</p>
        <MultiSelect
          options={allTags.map((tag) => ({ value: tag.id, label: tag.name }))}
          selected={selectedTagIds}
          onChange={onChange}
          placeholder={allTags.length ? "Add tags" : "No tags yet — create one below"}
          className="max-w-sm"
        />
        {canUpdate && (
          <div className="flex max-w-sm gap-2">
            <Input
              placeholder="New tag name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleCreate()}
              disabled={!name.trim() || createTag.isPending}
            >
              <Plus className="mr-1 h-4 w-4" /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
