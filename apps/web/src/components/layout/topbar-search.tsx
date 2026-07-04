"use client";

import type { SearchEntityType } from "@bmp/types";
import { Input } from "@bmp/ui";
import { Building2, FileText, HardHat, Search, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type KeyboardEvent } from "react";

import { useSearch } from "@/hooks/use-reports";

const ENTITY_ICONS: Record<SearchEntityType, ComponentType<{ className?: string }>> = {
  Tender: FileText,
  Organization: Building2,
  Vendor: Truck,
  Project: HardHat,
};

export function TopbarSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), 250);
    return () => clearTimeout(timer);
  }, [value]);

  const searchQuery = useSearch(debounced);
  const results = searchQuery.data?.results ?? [];
  const showDropdown = open && debounced.trim().length >= 2;

  function goToSearchPage() {
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(value)}`);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") goToSearchPage();
    if (e.key === "Escape") setOpen(false);
  }

  return (
    <div className="relative w-64">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
        placeholder="Search..."
        className="h-8 pl-8 text-sm"
        aria-label="Global search"
      />
      {showDropdown && (
        <div className="absolute left-0 top-full z-50 mt-1 w-80 rounded-md border bg-popover text-popover-foreground shadow-md">
          {searchQuery.isLoading ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">No results.</div>
          ) : (
            <div className="divide-y">
              {results.slice(0, 8).map((result) => {
                const Icon = ENTITY_ICONS[result.type];
                return (
                  <a
                    key={`${result.type}-${result.id}`}
                    href={result.href}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{result.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{result.type}</span>
                  </a>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={goToSearchPage}
            className="block w-full border-t px-3 py-2 text-center text-xs font-medium hover:bg-muted/50"
          >
            View all results
          </button>
        </div>
      )}
    </div>
  );
}
