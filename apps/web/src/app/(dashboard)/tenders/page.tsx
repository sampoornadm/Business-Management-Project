"use client";

import {
  TENDER_KIND_LABELS,
  TENDER_KINDS,
  TENDER_STATUS_LABELS,
  TENDER_STATUSES,
  TENDER_PRIORITIES,
  type FilterCondition,
  type TenderKind,
  type TenderPriority,
  type TenderSortField,
  type TenderStatus,
} from "@bmp/types";
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
import { Download, FilePlus, FileText, SearchX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  buildTenderColumnDefs,
  TENDER_COLUMNS,
  TENDER_DEFAULT_ORDER,
  TENDER_DEFAULT_VISIBLE_KEYS,
} from "@/components/tenders/tender-column-registry";
import {
  useCreateSavedView,
  useDeleteSavedView,
  useSavedViews,
  useUpdateSavedView,
} from "@/hooks/use-saved-views";
import { useTenders } from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { downloadFile } from "@/lib/download";
import { hasPermission } from "@/lib/permissions";

const PAGE_KEY = "tenders";
const FILTERABLE_COLUMNS = TENDER_COLUMNS.filter((c) => c.filterable);
const PICKER_COLUMNS = TENDER_COLUMNS.map((c) => ({ key: c.key, label: c.label }));

export default function TendersPage() {
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>(() => {
    const fromUrl = searchParams.get("status");
    return fromUrl && (TENDER_STATUSES as readonly string[]).includes(fromUrl) ? fromUrl : "";
  });
  const [priority, setPriority] = useState<string>("");
  const [kind, setKind] = useState<TenderKind>("TENDER");
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = useState<SortingState>([]);
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(TENDER_DEFAULT_VISIBLE_KEYS);
  const [columnOrder, setColumnOrder] = useState<string[]>(TENDER_DEFAULT_ORDER);
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

  const sortBy = sorting[0]?.id as TenderSortField | undefined;
  const sortDir = sorting[0] ? (sorting[0].desc ? "desc" : "asc") : undefined;

  const tendersQuery = useTenders({
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    search: debouncedSearch || undefined,
    status: (status || undefined) as TenderStatus | undefined,
    priority: (priority || undefined) as TenderPriority | undefined,
    kind,
    filters: conditions.length > 0 ? conditions : undefined,
    sortBy,
    sortDir,
  });

  const canCreate = hasPermission(roleName, "tenders:create");
  const canGenerateDocument = hasPermission(roleName, "tenders:generate_document");
  const hasActiveFilters = Boolean(debouncedSearch || status || priority || conditions.length > 0);

  function applySavedView(id: string) {
    setActiveViewId(id);
    if (id === DEFAULT_VIEW_ID) {
      setConditions([]);
      setVisibleKeys(TENDER_DEFAULT_VISIBLE_KEYS);
      setColumnOrder(TENDER_DEFAULT_ORDER);
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
        visibleKeys.join(",") !== TENDER_DEFAULT_VISIBLE_KEYS.join(",") ||
        columnOrder.join(",") !== TENDER_DEFAULT_ORDER.join(",") ||
        sorting.length > 0
      : !activeView ||
        JSON.stringify(activeView.filters) !== JSON.stringify(conditions) ||
        activeView.visibleColumns.join(",") !== visibleKeys.join(",") ||
        activeView.columnOrder.join(",") !== columnOrder.join(",") ||
        activeView.sortBy !== sortBy ||
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
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    params.set("kind", kind);
    if (conditions.length > 0) params.set("filters", JSON.stringify(conditions));
    if (sortBy) params.set("sortBy", sortBy);
    if (sortDir) params.set("sortDir", sortDir);
    params.set("columns", visibleKeys.join(","));
    try {
      await downloadFile(`/tenders/export?${params.toString()}`, `tenders-export.${format}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Export failed",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  const newTenderButton = (
    <Button asChild>
      <Link href="/tenders/new">
        <FilePlus className="mr-2 h-4 w-4" /> New Tender
      </Link>
    </Button>
  );

  const columns = useMemo(
    () => buildTenderColumnDefs({ visibleKeys, order: columnOrder, canGenerateDocument }),
    [visibleKeys, columnOrder, canGenerateDocument],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tenders"
        description="Track tenders from draft through award."
        actions={canCreate ? newTenderButton : undefined}
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
        <div className="flex gap-1">
          {TENDER_KINDS.map((option) => (
            <Button
              key={option}
              type="button"
              variant={kind === option ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setKind(option);
                setPagination((prev) => ({ ...prev, pageIndex: 0 }));
              }}
            >
              {TENDER_KIND_LABELS[option]}
            </Button>
          ))}
        </div>
        <Input
          placeholder="Search by title or tender number..."
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
          className="max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            {TENDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TENDER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={priority}
          onValueChange={(value) => {
            setPriority(value);
            setPagination((prev) => ({ ...prev, pageIndex: 0 }));
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            {TENDER_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
            defaultVisibleKeys={TENDER_DEFAULT_VISIBLE_KEYS}
            defaultOrder={TENDER_DEFAULT_ORDER}
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
        data={tendersQuery.data?.items ?? []}
        isLoading={tendersQuery.isLoading}
        pageCount={tendersQuery.data?.totalPages ?? 0}
        pagination={pagination}
        onPaginationChange={setPagination}
        sorting={sorting}
        onSortingChange={setSorting}
        emptyState={
          hasActiveFilters ? (
            <EmptyState
              icon={SearchX}
              title="No tenders match your filters"
              description="Try adjusting your search, status, or filters."
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="No tenders yet"
              description="Create your first tender to start tracking it from draft through award."
              action={canCreate ? newTenderButton : undefined}
            />
          )
        }
      />
    </div>
  );
}
