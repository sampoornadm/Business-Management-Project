"use client";

import type { SearchEntityType, SearchResultItemDto } from "@bmp/types";
import { Card, CardContent } from "@bmp/ui";
import { Building2, FileSearch, FileText, HardHat, Truck } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

const ENTITY_ICONS: Record<SearchEntityType, ComponentType<{ className?: string }>> = {
  Tender: FileText,
  Organization: Building2,
  Vendor: Truck,
  Project: HardHat,
  Attachment: FileSearch,
};

export function SearchResultList({ results }: { results: SearchResultItemDto[] }) {
  if (results.length === 0) return null;

  return (
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
                {result.subtitle && <p className="truncate text-xs text-muted-foreground">{result.subtitle}</p>}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">{result.type}</span>
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
