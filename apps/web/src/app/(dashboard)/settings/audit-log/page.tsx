"use client";

import type { AuditLogSortField, FilterCondition } from "@bmp/types";
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
  PageHeader,
  SavedViewTabs,
  useToast,
} from "@bmp/ui";
import type { PaginationState, SortingState } from "@tanstack/react-table";
import { Download, History } from "lucide-react";
import { useMemo, useState } from "react";

import {
  AUDIT_LOG_COLUMNS,
  AUDIT_LOG_DEFAULT_ORDER,
  AUDIT_LOG_DEFAULT_VISIBLE_KEYS,
  buildAuditLogColumnDefs,
} from "@/components/audit-log/audit-log-column-registry";
import { useAuditLogs } from "@/hooks/use-audit-logs";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from "@/hooks/use-saved-views";
import { downloadFile } from "@/lib/download";

const PAGE_KEY = "audit-log";
const PICKER_COLUMNS = AUDIT_LOG_COLUMNS.map((c) => ({ key: c.key, label: c.label }));

export default function AuditLogPage() {
  const { toast } = useToast();
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(AUDIT_LOG_DEFAULT_VISIBLE_KEYS);
  const [columnOrder, setColumnOrder] = useState<string[]>(AUDIT_LOG_DEFAULT_ORDER);
  const [activeViewId, setActiveViewId] = useState<string>(DEFAULT_VIEW_ID);

  const savedViewsQuery = useSavedViews(PAGE_KEY);
  const createSavedView = useCreateSavedView();
  const updateSavedView = useUpdateSavedView(PAGE_KEY);
  const deleteSavedView = useDeleteSavedView(PAGE_KEY);
  const savedViews = savedViewsQuery.data ?? [];

  const sortBy = sorting[0]?.id as AuditLogSortField | undefined;
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined;

  const auditQuery = useAuditLogs({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    filters: conditions.length > 0 ? conditions : undefined,
    sortBy,
    sortDir,
  });

  // "Actor" is filtered by actorId (a real, indexed column) server-side, but its filter-builder
  // options are derived here from actors actually present in the current view — same trick as
  // tenders' clientName column (see tenders/page.tsx). Recomputed as the page's data changes.
  const actorOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const log of auditQuery.data?.items ?? []) {
      if (log.actor) byId.set(log.actor.id, `${log.actor.firstName} ${log.actor.lastName}`);
    }
    return [...byId.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [auditQuery.data]);

  const filterableColumns = useMemo(
    () =>
      AUDIT_LOG_COLUMNS.filter((c) => c.filterable).map((c) =>
        c.key === "actorId" ? { ...c, enumOptions: actorOptions } : c,
      ),
    [actorOptions],
  );

  const hasActiveFilters = conditions.length > 0;

  function applySavedView(id: string) {
    setActiveViewId(id);
    if (id === DEFAULT_VIEW_ID) {
      setConditions([]);
      setVisibleKeys(AUDIT_LOG_DEFAULT_VISIBLE_KEYS);
      setColumnOrder(AUDIT_LOG_DEFAULT_ORDER);
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
        visibleKeys.join(",") !== AUDIT_LOG_DEFAULT_VISIBLE_KEYS.join(",") ||
        columnOrder.join(",") !== AUDIT_LOG_DEFAULT_ORDER.join(",") ||
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
      await downloadFile(`/audit-logs/export?${params.toString()}`, `audit-log-export.${format}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  const columns = useMemo(
    () => buildAuditLogColumnDefs({ visibleKeys, order: columnOrder }),
    [visibleKeys, columnOrder],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit Log"
        description="A record of security and business events across the platform."
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
        <ActiveFilterChips
          columns={filterableColumns}
          conditions={conditions}
          onChange={(next) => {
            setConditions(next);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <ColumnPicker
          columns={PICKER_COLUMNS}
          visibleKeys={visibleKeys}
          order={columnOrder}
          defaultVisibleKeys={AUDIT_LOG_DEFAULT_VISIBLE_KEYS}
          defaultOrder={AUDIT_LOG_DEFAULT_ORDER}
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

      <DataTable
        columns={columns}
        data={auditQuery.data?.items ?? []}
        isLoading={auditQuery.isLoading}
        pageCount={auditQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={History}
              title="No events match your filters"
              description="Try adjusting your filters."
            />
          ) : (
            <EmptyState
              icon={History}
              title="No activity yet"
              description="Security and business events will appear here as they happen."
            />
          )
        }
      />
    </div>
  );
}
