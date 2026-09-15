"use client";

import type { FilterCondition, PurchaseOrderSortField } from "@bmp/types";
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
import { Download, FilePlus2, SearchX } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import {
  buildPurchaseOrderColumnDefs,
  PURCHASE_ORDER_COLUMNS,
  PURCHASE_ORDER_DEFAULT_ORDER,
  PURCHASE_ORDER_DEFAULT_VISIBLE_KEYS,
} from "@/components/purchase-orders/purchase-order-column-registry";
import { usePurchaseOrders } from "@/hooks/use-purchase-orders";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from "@/hooks/use-saved-views";
import { useAuthStore } from "@/lib/auth-store";
import { downloadFile } from "@/lib/download";
import { hasPermission } from "@/lib/permissions";

const PAGE_KEY = "purchase-orders";
const PICKER_COLUMNS = PURCHASE_ORDER_COLUMNS.map((c) => ({ key: c.key, label: c.label }));

export default function PurchaseOrdersPage() {
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(PURCHASE_ORDER_DEFAULT_VISIBLE_KEYS);
  const [columnOrder, setColumnOrder] = useState<string[]>(PURCHASE_ORDER_DEFAULT_ORDER);
  const [activeViewId, setActiveViewId] = useState<string>(DEFAULT_VIEW_ID);

  const savedViewsQuery = useSavedViews(PAGE_KEY);
  const createSavedView = useCreateSavedView();
  const updateSavedView = useUpdateSavedView(PAGE_KEY);
  const deleteSavedView = useDeleteSavedView(PAGE_KEY);
  const savedViews = savedViewsQuery.data ?? [];

  const sortBy = sorting[0]?.id as PurchaseOrderSortField | undefined;
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined;

  const poQuery = usePurchaseOrders({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    filters: conditions.length > 0 ? conditions : undefined,
    sortBy,
    sortDir,
  });

  // "Vendor" is a text column server-side (matches by name, not id — see
  // purchase-orders.filter-columns.ts), but its filter-builder options are derived here from
  // vendors actually present in the current view, so users pick from a list instead of typing a
  // name. Recomputed as the page's data changes — the option list reflects what's currently
  // loaded. Mirrors tenders/page.tsx's clientOptions treatment of its "Client" column.
  const vendorOptions = useMemo(() => {
    const names = new Set((poQuery.data?.items ?? []).map((po) => po.vendor.name));
    return [...names].sort().map((name) => ({ value: name, label: name }));
  }, [poQuery.data]);

  const filterableColumns = useMemo(
    () =>
      PURCHASE_ORDER_COLUMNS.filter((c) => c.filterable).map((c) =>
        c.key === "vendorName" ? { ...c, type: "enum" as const, enumOptions: vendorOptions } : c,
      ),
    [vendorOptions],
  );

  const canCreate = hasPermission(roleName, "purchase_orders:create");
  const hasActiveFilters = conditions.length > 0;

  function applySavedView(id: string) {
    setActiveViewId(id);
    if (id === DEFAULT_VIEW_ID) {
      setConditions([]);
      setVisibleKeys(PURCHASE_ORDER_DEFAULT_VISIBLE_KEYS);
      setColumnOrder(PURCHASE_ORDER_DEFAULT_ORDER);
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
        visibleKeys.join(",") !== PURCHASE_ORDER_DEFAULT_VISIBLE_KEYS.join(",") ||
        columnOrder.join(",") !== PURCHASE_ORDER_DEFAULT_ORDER.join(",") ||
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
    if (conditions.length > 0) params.set("filters", JSON.stringify(conditions));
    if (sortBy) params.set("sortBy", sortBy);
    if (sortDir) params.set("sortDir", sortDir);
    params.set("columns", visibleKeys.join(","));
    try {
      await downloadFile(`/purchase-orders/export?${params.toString()}`, `purchase-orders-export.${format}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  const createPoButton = (
    <Button asChild>
      <Link href="/purchase-orders/new">
        <FilePlus2 className="mr-2 h-4 w-4" /> Create Purchase Order
      </Link>
    </Button>
  );

  const columns = useMemo(
    () => buildPurchaseOrderColumnDefs({ visibleKeys, order: columnOrder }),
    [visibleKeys, columnOrder],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Purchase Orders"
        description="Track orders placed with vendors and their delivery status."
        actions={canCreate ? createPoButton : undefined}
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
            defaultVisibleKeys={PURCHASE_ORDER_DEFAULT_VISIBLE_KEYS}
            defaultOrder={PURCHASE_ORDER_DEFAULT_ORDER}
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
        data={poQuery.data?.items ?? []}
        isLoading={poQuery.isLoading}
        pageCount={poQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="No purchase orders match your filters"
              description="Try adjusting your filters."
            />
          ) : (
            <EmptyState
              icon={FilePlus2}
              title="No purchase orders yet"
              description="Create a purchase order to start tracking deliveries from a vendor."
              action={canCreate ? createPoButton : undefined}
            />
          )
        }
      />
    </div>
  );
}
