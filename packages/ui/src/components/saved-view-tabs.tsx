"use client";

import { MoreHorizontal, Plus } from "lucide-react";
import * as React from "react";

import { Button } from "./button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./dropdown-menu";
import { Input } from "./input";
import { Tabs, TabsList, TabsTrigger } from "./tabs";

export const DEFAULT_VIEW_ID = "__default__";

export interface SavedViewTabItem {
  id: string;
  name: string;
}

export interface SavedViewTabsProps {
  views: SavedViewTabItem[];
  activeId: string;
  hasUnsavedChanges: boolean;
  onSelect: (id: string) => void;
  onSaveNew: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onUpdate: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SavedViewTabs({
  views,
  activeId,
  hasUnsavedChanges,
  onSelect,
  onSaveNew,
  onRename,
  onUpdate,
  onDelete,
}: SavedViewTabsProps) {
  const [namingOpen, setNamingOpen] = React.useState(false);
  const [draftName, setDraftName] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);

  function submitNewView() {
    if (!draftName.trim()) return;
    onSaveNew(draftName.trim());
    setDraftName("");
    setNamingOpen(false);
  }

  function submitRename() {
    if (!renamingId || !draftName.trim()) return;
    onRename(renamingId, draftName.trim());
    setDraftName("");
    setRenamingId(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={activeId} onValueChange={onSelect}>
        <TabsList>
          <TabsTrigger value={DEFAULT_VIEW_ID}>Default</TabsTrigger>
          {views.map((view) => (
            <div key={view.id} className="flex items-center">
              <TabsTrigger value={view.id}>{view.name}</TabsTrigger>
              {activeId === view.id && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="ml-0.5 text-muted-foreground hover:text-foreground">
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onSelect={() => {
                        setRenamingId(view.id);
                        setDraftName(view.name);
                      }}
                    >
                      Rename
                    </DropdownMenuItem>
                    {hasUnsavedChanges && (
                      <DropdownMenuItem onSelect={() => onUpdate(view.id)}>
                        Update with current filters
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={() => onDelete(view.id)} className="text-destructive">
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </TabsList>
      </Tabs>

      {renamingId ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitRename()}
            className="h-8 w-40"
          />
          <Button type="button" size="sm" onClick={submitRename}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
            Cancel
          </Button>
        </div>
      ) : namingOpen ? (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            placeholder="View name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNewView()}
            className="h-8 w-40"
          />
          <Button type="button" size="sm" onClick={submitNewView}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setNamingOpen(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        hasUnsavedChanges && (
          <Button type="button" variant="outline" size="sm" onClick={() => setNamingOpen(true)}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Save as view
          </Button>
        )
      )}
    </div>
  );
}
