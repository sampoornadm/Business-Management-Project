"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/utils";

import { Checkbox } from "./checkbox";
import { Input } from "./input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

export interface EditableTreeRow {
  id: string;
  children?: EditableTreeRow[];
}

export interface EditableTreeColumn<TRow extends EditableTreeRow> {
  key: string;
  header: string;
  align?: "left" | "right";
  widthClassName?: string;
  /** Read-only render for this cell. Ignored if `editable` is true. */
  render?: (row: TRow) => React.ReactNode;
  editable?: boolean;
  inputType?: "text" | "number";
  getValue?: (row: TRow) => string | number | null;
  onCommit?: (row: TRow, value: string) => void;
}

export interface EditableTreeTableProps<TRow extends EditableTreeRow> {
  data: TRow[];
  columns: EditableTreeColumn<TRow>[];
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Rows that fail this check render without a checkbox (e.g. category header rows). */
  isRowSelectable?: (row: TRow) => boolean;
  renderRowActions?: (row: TRow) => React.ReactNode;
  emptyMessage?: string;
}

function flatten<TRow extends EditableTreeRow>(
  rows: TRow[],
  depth: number,
  expanded: Set<string>,
  out: Array<{ row: TRow; depth: number }>,
): void {
  for (const row of rows) {
    out.push({ row, depth });
    const children = row.children as TRow[] | undefined;
    if (children && children.length > 0 && expanded.has(row.id)) {
      flatten(children, depth + 1, expanded, out);
    }
  }
}

function collectAllIds<TRow extends EditableTreeRow>(rows: TRow[], out: Set<string>): Set<string> {
  for (const row of rows) {
    out.add(row.id);
    if (row.children?.length) collectAllIds(row.children as TRow[], out);
  }
  return out;
}

function EditableCell<TRow extends EditableTreeRow>({
  row,
  column,
}: {
  row: TRow;
  column: EditableTreeColumn<TRow>;
}) {
  const initial = column.getValue?.(row) ?? "";
  const [value, setValue] = React.useState(String(initial ?? ""));

  React.useEffect(() => {
    setValue(String(column.getValue?.(row) ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.getValue?.(row)]);

  return (
    <Input
      type={column.inputType === "number" ? "number" : "text"}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const original = String(column.getValue?.(row) ?? "");
        if (value !== original) column.onCommit?.(row, value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-8 w-full min-w-[6rem]"
    />
  );
}

/**
 * Generic nested/hierarchical editable grid: expand/collapse rows, inline-editable
 * cells, row selection for bulk actions. Built for the BOQ item tree; kept
 * domain-agnostic so Purchase Order line items (Phase 4) can reuse it as-is.
 */
export function EditableTreeTable<TRow extends EditableTreeRow>({
  data,
  columns,
  selectable = false,
  selectedIds,
  onSelectionChange,
  isRowSelectable,
  renderRowActions,
  emptyMessage = "No rows yet.",
}: EditableTreeTableProps<TRow>) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => collectAllIds(data, new Set()));

  React.useEffect(() => {
    setExpanded(collectAllIds(data, new Set()));
  }, [data]);

  const flatRows = React.useMemo(() => {
    const out: Array<{ row: TRow; depth: number }> = [];
    flatten(data, 0, expanded, out);
    return out;
  }, [data, expanded]);

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelected(id: string) {
    if (!onSelectionChange) return;
    const next = new Set(selectedIds ?? []);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && <TableHead className="w-10" />}
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn(column.align === "right" && "text-right", column.widthClassName)}
              >
                {column.header}
              </TableHead>
            ))}
            {renderRowActions && <TableHead className="w-10" />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {flatRows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (selectable ? 1 : 0) + (renderRowActions ? 1 : 0)}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            flatRows.map(({ row, depth }) => {
              const hasChildren = Boolean(row.children && row.children.length > 0);
              const rowSelectable = selectable && (isRowSelectable ? isRowSelectable(row) : true);
              return (
                <TableRow key={row.id}>
                  {selectable && (
                    <TableCell className="w-10">
                      {rowSelectable && (
                        <Checkbox
                          checked={selectedIds?.has(row.id) ?? false}
                          onCheckedChange={() => toggleSelected(row.id)}
                          aria-label="Select row"
                        />
                      )}
                    </TableCell>
                  )}
                  {columns.map((column, columnIndex) => (
                    <TableCell
                      key={column.key}
                      className={cn(column.align === "right" && "text-right")}
                    >
                      {columnIndex === 0 ? (
                        <div className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
                          {hasChildren ? (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(row.id)}
                              className="shrink-0 rounded p-0.5 hover:bg-muted"
                              aria-label={expanded.has(row.id) ? "Collapse row" : "Expand row"}
                            >
                              {expanded.has(row.id) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </button>
                          ) : (
                            <span className="inline-block w-5 shrink-0" />
                          )}
                          {column.editable ? (
                            <EditableCell row={row} column={column} />
                          ) : (
                            (column.render?.(row) ?? column.getValue?.(row) ?? "")
                          )}
                        </div>
                      ) : column.editable ? (
                        <EditableCell row={row} column={column} />
                      ) : (
                        (column.render?.(row) ?? column.getValue?.(row) ?? "")
                      )}
                    </TableCell>
                  ))}
                  {renderRowActions && <TableCell className="w-10">{renderRowActions(row)}</TableCell>}
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
