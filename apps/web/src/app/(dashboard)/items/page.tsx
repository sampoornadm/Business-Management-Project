"use client";

import type { FilterCondition, ItemSortField, ListItemsQuery } from "@bmp/types";
import {
  ActiveFilterChips,
  Button,
  ColumnPicker,
  DataTable,
  DEFAULT_VIEW_ID,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  FilterBar,
  Input,
  PageHeader,
  SavedViewTabs,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { Download, ListTree, Loader2, Package, SearchX, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  buildItemColumnDefs,
  ITEM_COLUMNS,
  ITEM_DEFAULT_ORDER,
  ITEM_DEFAULT_VISIBLE_KEYS,
} from "@/components/items/item-column-registry";
import { useCategoryLeaves } from "@/hooks/use-categories";
import { useClassifyItemsBatch, useItems } from "@/hooks/use-items";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from "@/hooks/use-saved-views";
import { useAuthStore } from "@/lib/auth-store";
import { downloadFile } from "@/lib/download";
import { hasPermission } from "@/lib/permissions";

const PAGE_KEY = "items";
const PICKER_COLUMNS = ITEM_COLUMNS.map((c) => ({ key: c.key, label: c.label }));

const ALL = "all";
const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ALL, label: "All items" },
  { value: "unclassified", label: "Unclassified" },
  { value: "unconfirmed", label: "AI, unconfirmed" },
  { value: "needs_review", label: "Needs review" },
  { value: "classified", label: "Confirmed" },
];

export default function ItemsPage() {
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canUpdate = hasPermission(roleName, "rfq:update");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  // "status" is a derived multi-field state (categoryId null / categoryConfirmed / needsReview —
  // see items.repository.ts's statusWhere) that can't be expressed as a single filter chip, so
  // it stays its own quick-filter dropdown alongside the new "+" advanced filters, same as how
  // Tenders kept its "kind" toggle separate from the filter chips.
  const [status, setStatus] = useState(ALL);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(ITEM_DEFAULT_VISIBLE_KEYS);
  const [columnOrder, setColumnOrder] = useState<string[]>(ITEM_DEFAULT_ORDER);
  const [activeViewId, setActiveViewId] = useState<string>(DEFAULT_VIEW_ID);

  const classifyBatch = useClassifyItemsBatch();

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const savedViewsQuery = useSavedViews(PAGE_KEY);
  const createSavedView = useCreateSavedView();
  const updateSavedView = useUpdateSavedView(PAGE_KEY);
  const deleteSavedView = useDeleteSavedView(PAGE_KEY);
  const savedViews = savedViewsQuery.data ?? [];

  const sortBy = sorting[0]?.id as ItemSortField | undefined;
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined;

  const itemsQuery = useItems({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
    status: status === ALL ? undefined : (status as ListItemsQuery["status"]),
    filters: conditions.length > 0 ? conditions : undefined,
    sortBy,
    sortDir,
  });

  const categoryLeavesQuery = useCategoryLeaves();
  const categoryOptions = useMemo(
    () => (categoryLeavesQuery.data ?? []).map((leaf) => ({ value: leaf.id, label: leaf.path })),
    [categoryLeavesQuery.data],
  );

  const filterableColumns = useMemo(
    () =>
      ITEM_COLUMNS.filter((c) => c.filterable).map((c) =>
        c.key === "categoryPath" ? { ...c, type: "enum" as const, enumOptions: categoryOptions } : c,
      ),
    [categoryOptions],
  );

  const hasActiveFilters = Boolean(debouncedSearch || status !== ALL || conditions.length > 0);

  function applySavedView(id: string) {
    setActiveViewId(id);
    if (id === DEFAULT_VIEW_ID) {
      setConditions([]);
      setVisibleKeys(ITEM_DEFAULT_VISIBLE_KEYS);
      setColumnOrder(ITEM_DEFAULT_ORDER);
      setSorting([]);
      return;
    }
    const view = savedViews.find((v) => v.id === id);
    if (!view) return;
    setConditions(view.filters);
    setVisibleKeys(view.visibleColumns);
    setColumnOrder(view.columnOrder);
    setSorting(view.sortBy ? [{ id: view.sortBy, desc: view.sortDir === "desc" }] : []);
  }

  const activeView = savedViews.find((v) => v.id === activeViewId) ?? null;
  const hasUnsavedChanges =
    activeViewId === DEFAULT_VIEW_ID
      ? conditions.length > 0 ||
        visibleKeys.join(",") !== ITEM_DEFAULT_VISIBLE_KEYS.join(",") ||
        columnOrder.join(",") !== ITEM_DEFAULT_ORDER.join(",") ||
        sorting.length > 0
      : !activeView ||
        JSON.stringify(activeView.filters) !== JSON.stringify(conditions) ||
        activeView.visibleColumns.join(",") !== visibleKeys.join(",") ||
        activeView.columnOrder.join(",") !== columnOrder.join(",") ||
        (activeView.sortBy ?? undefined) !== sortBy ||
        (activeView.sortDir ?? undefined) !== sortDir;

  async function saveCurrentAsNewView(name: string) {
    try {
      const created = await createSavedView.mutateAsync({
        pageKey: PAGE_KEY,
        name,
        filters: conditions,
        visibleColumns: visibleKeys,
        columnOrder,
        sortBy,
        sortDir,
      });
      setActiveViewId(created.id);
      toast({ title: "View saved" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save view",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function updateActiveView(id: string) {
    try {
      await updateSavedView.mutateAsync({
        id,
        input: { filters: conditions, visibleColumns: visibleKeys, columnOrder, sortBy, sortDir },
      });
      toast({ title: "View updated" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update view",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function renameView(id: string, name: string) {
    try {
      await updateSavedView.mutateAsync({ id, input: { name } });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not rename view",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function deleteView(id: string) {
    try {
      await deleteSavedView.mutateAsync(id);
      if (activeViewId === id) applySavedView(DEFAULT_VIEW_ID);
      toast({ title: "View deleted" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete view",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleExport(format: "csv" | "xlsx", scope: "view" | "all") {
    const params = new URLSearchParams();
    params.set("format", format);
    params.set("scope", scope);
    params.set("page", String(pagination.pageIndex + 1));
    params.set("pageSize", String(pagination.pageSize));
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (status !== ALL) params.set("status", status);
    if (conditions.length > 0) params.set("filters", JSON.stringify(conditions));
    if (sortBy) params.set("sortBy", sortBy);
    if (sortDir) params.set("sortDir", sortDir);
    params.set("columns", visibleKeys.join(","));
    try {
      await downloadFile(`/items/export?${params.toString()}`, `items-export.${format}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

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
        description: error instanceof Error ? error.message : "Is the local AI (Ollama) running?",
      });
    }
  }

  const headerActions = (
    <>
      <Button variant="outline" asChild>
        <Link href="/items/categories">
          <ListTree className="mr-2 h-4 w-4" /> Manage categories
        </Link>
      </Button>
      {canUpdate && (
        <Button onClick={handleClassify} disabled={classifyBatch.isPending}>
          {classifyBatch.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {classifyBatch.isPending ? "Classifying…" : "Classify with AI"}
        </Button>
      )}
    </>
  );

  const columns = useMemo(
    () => buildItemColumnDefs({ visibleKeys, order: columnOrder }),
    [visibleKeys, columnOrder],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Items"
        description="Every quoted item, its category, and its historical vendor prices. Click an item for full history."
        actions={headerActions}
      />

      <SavedViewTabs
        views={savedViews.map((v) => ({ id: v.id, name: v.name }))}
        activeId={activeViewId}
        hasUnsavedChanges={hasUnsavedChanges}
        onSelect={applySavedView}
        onSaveNew={saveCurrentAsNewView}
        onRename={renameView}
        onUpdate={updateActiveView}
        onDelete={deleteView}
      />

      <FilterBar>
        <Input
          placeholder="Search items..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
          className="max-w-sm"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
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
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ActiveFilterChips
          columns={filterableColumns}
          conditions={conditions}
          onChange={(next) => {
            setConditions(next);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        />
        <div className="flex items-center gap-2">
          <ColumnPicker
            columns={PICKER_COLUMNS}
            visibleKeys={visibleKeys}
            order={columnOrder}
            defaultVisibleKeys={ITEM_DEFAULT_VISIBLE_KEYS}
            defaultOrder={ITEM_DEFAULT_ORDER}
            onChange={({ visibleKeys: nextVisible, order: nextOrder }) => {
              setVisibleKeys(nextVisible);
              setColumnOrder(nextOrder);
            }}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => handleExport("csv", "view")}>
                Current view (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport("xlsx", "view")}>
                Current view (XLSX)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport("csv", "all")}>
                All matching (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport("xlsx", "all")}>
                All matching (XLSX)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={itemsQuery.data?.items ?? []}
        isLoading={itemsQuery.isLoading}
        pageCount={itemsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="No items match your filters"
              description="Try adjusting your search or filters."
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
