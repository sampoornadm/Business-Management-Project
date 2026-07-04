"use client";

import type { SearchEntityType } from "@bmp/types";
import { Card, CardContent, Input } from "@bmp/ui";
import { Building2, FileText, HardHat, Search, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ComponentType } from "react";

import { useSearch } from "@/hooks/use-reports";

const ENTITY_ICONS: Record<SearchEntityType, ComponentType<{ className?: string }>> = {
  Tender: FileText,
  Organization: Building2,
  Vendor: Truck,
  Project: HardHat,
};

export default function SearchPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(initialQuery);

  const searchQuery = useSearch(query);
  const results = searchQuery.data?.results ?? [];

  function handleChange(value: string) {
    setQuery(value);
    const params = new URLSearchParams();
    if (value) params.set("q", value);
    router.replace(`/search?${params.toString()}`);
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">Find tenders, organizations, vendors, and projects.</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Search..."
          className="pl-9"
        />
      </div>

      {query.trim().length > 0 && query.trim().length < 2 ? (
        <p className="text-sm text-muted-foreground">Keep typing — at least 2 characters.</p>
      ) : query.trim().length === 0 ? (
        <p className="text-sm text-muted-foreground">Start typing to search.</p>
      ) : searchQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Searching...</p>
      ) : results.length === 0 ? (
        <p className="text-sm text-muted-foreground">No results for &quot;{query}&quot;.</p>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {results.map((result) => {
              const Icon = ENTITY_ICONS[result.type];
              return (
                <Link
                  key={`${result.type}-${result.id}`}
                  href={result.href}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{result.title}</p>
                    {result.subtitle && (
                      <p className="truncate text-xs text-muted-foreground">{result.subtitle}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{result.type}</span>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
