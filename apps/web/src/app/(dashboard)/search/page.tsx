"use client";

import { Input } from "@bmp/ui";
import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { SearchResultList } from "@/components/search/search-result-list";
import { useSearch } from "@/hooks/use-reports";

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
        <SearchResultList results={results} />
      )}
    </div>
  );
}
