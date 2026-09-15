"use client";

import type { BillSortField, FilterCondition } from "@bmp/types";
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
  PageHeader,
  SavedViewTabs,
  useToast,
} from "@bmp/ui";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { Download, Receipt, SearchX, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  BILL_COLUMNS,
  BILL_DEFAULT_ORDER,
  BILL_DEFAULT_VISIBLE_KEYS,
  buildBillColumnDefs,
} from "@/components/bills/bills-column-registry";
import { useBills } from "@/hooks/use-bills";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from "@/hooks/use-saved-views";
import { downloadFile } from "@/lib/download";

const PAGE_KEY = "bills";
const PICKER_COLUMNS = BILL_COLUMNS.map((c) => ({ key: c.key, label: c.label }));

export default function BillsPage() {
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const tenderId = searchParams.get("tenderId") ?? undefined;
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(BILL_DEFAULT_VISIBLE_KEYS);
  const [columnOrder, setColumnOrder] = useState<string[]>(BILL_DEFAULT_ORDER);
  const [activeViewId, setActiveViewId] = useState<string>(DEFAULT_VIEW_ID);

  const savedViewsQuery = useSavedViews(PAGE_KEY);
  const createSavedView = useCreateSavedView();
  const updateSavedView = useUpdateSavedView(PAGE_KEY);
  const deleteSavedView = useDeleteSavedView(PAGE_KEY);
  const savedViews = savedViewsQuery.data ?? [];

  const sortBy = sorting[0]?.id as BillSortField | undefined;
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined;

  const billsQuery = useBills({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    tenderId,
    filters: conditions.length > 0 ? conditions : undefined,
    sortBy,
    sortDir,
  });
  const tenderTitle = billsQuery.data?.items[0]?.tenderTitle;

  // "Client" is a text column server-side (matches by name, not id — see
  // bills.filter-columns.ts), but its filter-builder options are derived here from clients
  // actually present in the current view, mirroring tenders/page.tsx's clientOptions.
  const clientOptions = useMemo(() => {
    const names = new Set((billsQuery.data?.items ?? []).map((b) => b.clientName));
    return [...names].sort().map((name) => ({ value: name, label: name }));
  }, [billsQuery.data]);

  const filterableColumns = useMemo(
    () =>
      BILL_COLUMNS.filter((c) => c.filterable).map((c) =>
        c.key === "clientName" ? { ...c, type: "enum" as const, enumOptions: clientOptions } : c,
      ),
    [clientOptions],
  );

  const hasActiveFilters = conditions.length > 0;

  function applySavedView(id: string) {
    setActiveViewId(id);
    if (id === DEFAULT_VIEW_ID) {
      setConditions([]);
      setVisibleKeys(BILL_DEFAULT_VISIBLE_KEYS);
      setColumnOrder(BILL_DEFAULT_ORDER);
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
        visibleKeys.join(",") !== BILL_DEFAULT_VISIBLE_KEYS.join(",") ||
        columnOrder.join(",") !== BILL_DEFAULT_ORDER.join(",") ||
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
    if (tenderId) params.set("tenderId", tenderId);
    if (conditions.length > 0) params.set("filters", JSON.stringify(conditions));
    if (sortBy) params.set("sortBy", sortBy);
    if (sortDir) params.set("sortDir", sortDir);
    params.set("columns", visibleKeys.join(","));
    try {
      await downloadFile(`/bills/export?${params.toString()}`, `bills-export.${format}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  const columns = useMemo(
    () =>
      buildBillColumnDefs({
        visibleKeys,
        order: columnOrder,
        onDownloadError: (message) =>
          toast({ variant: "destructive", title: "Could not download PDF", description: message }),
      }),
    [visibleKeys, columnOrder, toast],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Bills"
        description={
          tenderId
            ? `Filtered to ${tenderTitle ?? "this tender"}.`
            : "Every bill raised against a won tender, across all clients."
        }
        actions={
          tenderId ? (
            <Button asChild variant="ghost" size="sm">
              <Link href="/bills">
                <X className="mr-2 h-4 w-4" /> Clear filter
              </Link>
            </Button>
          ) : undefined
        }
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
            defaultVisibleKeys={BILL_DEFAULT_VISIBLE_KEYS}
            defaultOrder={BILL_DEFAULT_ORDER}
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
        data={billsQuery.data?.items ?? []}
        isLoading={billsQuery.isLoading}
        pageCount={billsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="No bills match your filters"
              description="Try adjusting your filters."
            />
          ) : (
            <EmptyState
              icon={Receipt}
              title="No bills yet"
              description={
                tenderId
                  ? "This tender has no bills yet."
                  : "Bills are created from a won tender's detail page."
              }
              action={
                tenderId ? undefined : (
                  <Button asChild variant="outline">
                    <Link href="/tenders">Go to Tenders</Link>
                  </Button>
                )
              }
            />
          )
        }
      />
    </div>
  );
}
