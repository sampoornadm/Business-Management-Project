"use client";

import type { FilterCondition, VendorSortField } from "@bmp/types";
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
  useToast,
} from "@bmp/ui";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { Download, SearchX, Truck, Upload, UserPlus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { ImportItemTagsDialog } from "@/components/vendors/import-item-tags-dialog";
import {
  buildVendorColumnDefs,
  VENDOR_COLUMNS,
  VENDOR_DEFAULT_ORDER,
  VENDOR_DEFAULT_VISIBLE_KEYS,
} from "@/components/vendors/vendor-column-registry";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from "@/hooks/use-saved-views";
import { useVendors } from "@/hooks/use-vendors";
import { useAuthStore } from "@/lib/auth-store";
import { downloadFile } from "@/lib/download";
import { hasPermission } from "@/lib/permissions";

const PAGE_KEY = "vendors";
const PICKER_COLUMNS = VENDOR_COLUMNS.map((c) => ({ key: c.key, label: c.label }));
const FILTERABLE_COLUMNS = VENDOR_COLUMNS.filter((c) => c.filterable);

export default function VendorsPage() {
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(VENDOR_DEFAULT_VISIBLE_KEYS);
  const [columnOrder, setColumnOrder] = useState<string[]>(VENDOR_DEFAULT_ORDER);
  const [activeViewId, setActiveViewId] = useState<string>(DEFAULT_VIEW_ID);

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const savedViewsQuery = useSavedViews(PAGE_KEY);
  const createSavedView = useCreateSavedView();
  const updateSavedView = useUpdateSavedView(PAGE_KEY);
  const deleteSavedView = useDeleteSavedView(PAGE_KEY);
  const savedViews = savedViewsQuery.data ?? [];

  const sortBy = sorting[0]?.id as VendorSortField | undefined;
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined;

  const vendorsQuery = useVendors({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
    filters: conditions.length > 0 ? conditions : undefined,
    sortBy,
    sortDir,
  });

  const canCreate = hasPermission(roleName, "vendors:create");
  const hasActiveFilters = Boolean(debouncedSearch || conditions.length > 0);

  function applySavedView(id: string) {
    setActiveViewId(id);
    if (id === DEFAULT_VIEW_ID) {
      setConditions([]);
      setVisibleKeys(VENDOR_DEFAULT_VISIBLE_KEYS);
      setColumnOrder(VENDOR_DEFAULT_ORDER);
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
        visibleKeys.join(",") !== VENDOR_DEFAULT_VISIBLE_KEYS.join(",") ||
        columnOrder.join(",") !== VENDOR_DEFAULT_ORDER.join(",") ||
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
    if (conditions.length > 0) params.set("filters", JSON.stringify(conditions));
    if (sortBy) params.set("sortBy", sortBy);
    if (sortDir) params.set("sortDir", sortDir);
    params.set("columns", visibleKeys.join(","));
    try {
      await downloadFile(`/vendors/export?${params.toString()}`, `vendors-export.${format}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  const addVendorButton = (
    <Button asChild>
      <Link href="/vendors/new">
        <UserPlus className="mr-2 h-4 w-4" /> Add Vendor
      </Link>
    </Button>
  );

  const headerActions = canCreate ? (
    <div className="flex gap-2">
      <ImportItemTagsDialog
        trigger={
          <Button variant="outline">
            <Upload className="mr-2 h-4 w-4" /> Import item tags
          </Button>
        }
      />
      {addVendorButton}
    </div>
  ) : undefined;

  const columns = useMemo(
    () => buildVendorColumnDefs({ visibleKeys, order: columnOrder }),
    [visibleKeys, columnOrder],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Vendors"
        description="Suppliers, service providers, and subcontractors used across procurement."
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
          placeholder="Search by name..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
          className="max-w-xs"
        />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ActiveFilterChips
          columns={FILTERABLE_COLUMNS}
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
            defaultVisibleKeys={VENDOR_DEFAULT_VISIBLE_KEYS}
            defaultOrder={VENDOR_DEFAULT_ORDER}
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
        data={vendorsQuery.data?.items ?? []}
        isLoading={vendorsQuery.isLoading}
        pageCount={vendorsQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="No vendors match your filters"
              description="Try adjusting your search or filters."
            />
          ) : (
            <EmptyState
              icon={Truck}
              title="No vendors yet"
              description="Add the suppliers, service providers, and subcontractors you work with."
              action={canCreate ? addVendorButton : undefined}
            />
          )
        }
      />
    </div>
  );
}
