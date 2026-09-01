"use client";

import type { ItemListEntryDto, ItemSortField, ListItemsQuery } from "@bmp/types";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  formatDate,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
import type { Column, ColumnDef, OnChangeFn, PaginationState, SortingState } from "@tanstack/react-table";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ListTree,
  Package,
  SearchX,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { useClassifyItemsBatch, useItems } from "@/hooks/use-items";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const ALL = "all";
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ALL, label: "All items" },
  { value: "unclassified", label: "Unclassified" },
  { value: "unconfirmed", label: "AI, unconfirmed" },
  { value: "needs_review", label: "Needs review" },
  { value: "classified", label: "Confirmed" },
];

function SortHeader({ column, label }: { column: Column<ItemListEntryDto, unknown>; label: string }) {
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className="flex items-center gap-1 hover:text-foreground"
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="h-3 w-3" />
      ) : sorted === "desc" ? (
        <ArrowDown className="h-3 w-3" />
      ) : (
        <ChevronsUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

function CategoryCell({ entry }: { entry: ItemListEntryDto }) {
  if (!entry.categoryPath) return <span className="text-muted-foreground">Unclassified</span>;
  if (entry.confirmed) return <span>{entry.categoryPath}</span>;
  if (entry.needsReview) {
    return (
      <Badge
        variant="destructive"
        className="gap-1"
        title="AI classified this with low similarity to any known item — please double-check."
      >
        <AlertTriangle className="h-3 w-3" /> AI: {entry.categoryPath}
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      title={entry.aiConfidence !== null ? `AI confidence ${Math.round(entry.aiConfidence * 100)}%` : undefined}
    >
      AI: {entry.categoryPath}
    </Badge>
  );
}

function rateRange(entry: ItemListEntryDto): string {
  if (entry.minRate === null || entry.maxRate === null) return "-";
  return entry.minRate === entry.maxRate
    ? entry.minRate.toLocaleString()
    : `${entry.minRate.toLocaleString()} – ${entry.maxRate.toLocaleString()}`;
}

const columns: ColumnDef<ItemListEntryDto>[] = [
  {
    accessorKey: "canonicalName",
    header: ({ column }) => <SortHeader column={column} label="Item" />,
    cell: ({ row }) => (
      <Link href={`/items/${row.original.id}`} className="font-medium hover:underline">
        {row.original.canonicalName}
      </Link>
    ),
  },
  {
    accessorKey: "categoryPath",
    header: ({ column }) => <SortHeader column={column} label="Category" />,
    cell: ({ row }) => <CategoryCell entry={row.original} />,
  },
  {
    accessorKey: "quoteCount",
    header: ({ column }) => <SortHeader column={column} label="Quotes" />,
    cell: ({ row }) => <span className="tabular-nums">{row.original.quoteCount}</span>,
  },
  {
    accessorKey: "vendorCount",
    header: "Vendors",
    enableSorting: false,
    cell: ({ row }) => <span className="tabular-nums">{row.original.vendorCount}</span>,
  },
  {
    accessorKey: "minRate",
    header: ({ column }) => <SortHeader column={column} label="Rate range" />,
    cell: ({ row }) => <span className="tabular-nums">{rateRange(row.original)}</span>,
  },
  {
    accessorKey: "avgRate",
    header: ({ column }) => <SortHeader column={column} label="Avg" />,
    cell: ({ row }) => (
      <span className="tabular-nums">{row.original.avgRate?.toLocaleString() ?? "-"}</span>
    ),
  },
  {
    accessorKey: "lastQuotedAt",
    header: ({ column }) => <SortHeader column={column} label="Last quoted" />,
    cell: ({ row }) => (row.original.lastQuotedAt ? formatDate(row.original.lastQuotedAt) : "-"),
  },
];

export default function ItemsPage() {
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canUpdate = hasPermission(roleName, "rfq:update");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });

  const classifyBatch = useClassifyItemsBatch();

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const resetToFirstPage = () => setPagination((prev) => ({ ...prev, pageIndex: 0 }));
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting((prev) => (typeof updater === "function" ? updater(prev) : updater));
    resetToFirstPage();
  };

  const sort = sorting[0];
  const itemsQuery = useItems({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
    status: status === ALL ? undefined : (status as ListItemsQuery["status"]),
    sortBy: sort ? (sort.id as ItemSortField) : undefined,
    sortDir: sort ? (sort.desc ? "desc" : "asc") : undefined,
  });

  async function handleClassify() {
    try {
      const result = await classifyBatch.mutateAsync(10);
      const unmatchedNote = result.unmatched > 0 ? ` · ${result.unmatched} had no clear match` : "";
      toast({
        title: `Classified ${result.classified} item(s)${unmatchedNote}`,
        description:
          result.remaining > 0
            ? `${result.remaining} still unclassified — run again, or set them manually.`
            : "All items classified — review the AI suggestions and confirm.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not classify",
        description:
          error instanceof Error ? error.message : "Is the local AI (Ollama) running?",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Items</h1>
          <p className="text-sm text-muted-foreground">
            Every quoted item, its category, and its historical vendor prices. Click an item for full
            history.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/items/categories">
              <ListTree className="mr-2 h-4 w-4" /> Manage categories
            </Link>
          </Button>
          {canUpdate && (
            <Button onClick={handleClassify} disabled={classifyBatch.isPending}>
              <Sparkles className="mr-2 h-4 w-4" />
              {classifyBatch.isPending ? "Classifying…" : "Classify with AI"}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search items..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            resetToFirstPage();
          }}
          className="max-w-sm"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            resetToFirstPage();
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={itemsQuery.data?.items ?? []}
        isLoading={itemsQuery.isLoading}
        pageCount={itemsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={handleSortingChange}
        emptyState={
          debouncedSearch || status !== ALL ? (
            <EmptyState
              icon={SearchX}
              title="No items match your filters"
              description="Try adjusting your search or status filter."
            />
          ) : (
            <EmptyState
              icon={Package}
              title="No items yet"
              description="Items appear here once they're quoted on an RFQ or BOQ."
            />
          )
        }
      />
    </div>
  );
}
