"use client";

import { BOQ_COLUMN_FIELDS, type BoqColumnField, type BoqParsePreviewDto, type CommitBoqItemInput } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bmp/ui";
import { useState } from "react";

import { useCommitBoq, useParseBoqFile } from "@/hooks/use-boq";

const FIELD_LABELS: Record<BoqColumnField, string> = {
  itemCode: "Item code",
  description: "Description",
  category: "Category",
  unit: "Unit",
  quantity: "Quantity",
  rate: "Rate",
};

const UNMAPPED = "__unmapped__";

export function BoqUploadPanel({
  tenderId,
  replacesBoqId,
  onCommitted,
}: {
  tenderId: string;
  replacesBoqId?: string;
  onCommitted?: () => void;
}) {
  const { toast } = useToast();
  const parse = useParseBoqFile(tenderId);
  const commit = useCommitBoq(tenderId);

  const [preview, setPreview] = useState<BoqParsePreviewDto | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<BoqColumnField, string>>>({});

  async function handleFileSelected(file: File) {
    try {
      const result = await parse.mutateAsync(file);
      setPreview(result);
      setMapping(result.suggestedMapping);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not parse file",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleCommit() {
    if (!preview) return;
    if (!mapping.description) {
      toast({ variant: "destructive", title: "Map a Description column before committing" });
      return;
    }

    const items: CommitBoqItemInput[] = preview.rows
      .map((row): CommitBoqItemInput | null => {
        const description = mapping.description ? row.cells[mapping.description] : null;
        if (!description) return null;
        const quantityCell = mapping.quantity ? row.cells[mapping.quantity] : null;
        const rateCell = mapping.rate ? row.cells[mapping.rate] : null;
        return {
          tempId: String(row.rowIndex),
          description: String(description),
          itemCode: mapping.itemCode ? (row.cells[mapping.itemCode] ?? undefined)?.toString() : undefined,
          category: mapping.category ? (row.cells[mapping.category] ?? undefined)?.toString() : undefined,
          unit: mapping.unit ? (row.cells[mapping.unit] ?? undefined)?.toString() : undefined,
          quantity: quantityCell !== null && quantityCell !== "" ? Number(quantityCell) : undefined,
          rate: rateCell !== null && rateCell !== "" ? Number(rateCell) : undefined,
          sortOrder: row.rowIndex,
        };
      })
      .filter((item): item is CommitBoqItemInput => item !== null);

    if (items.length === 0) {
      toast({ variant: "destructive", title: "No rows to commit", description: "Check your column mapping." });
      return;
    }

    try {
      await commit.mutateAsync({ sourceAttachmentId: preview.sourceAttachmentId, replacesBoqId, items });
      toast({ title: "BOQ committed" });
      setPreview(null);
      onCommitted?.();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not commit BOQ",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (!preview) {
    return (
      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm text-muted-foreground">
            Upload a BOQ spreadsheet (.xlsx) or PDF. You&apos;ll confirm the column mapping before any
            rows are saved.
          </p>
          <input
            type="file"
            accept=".xlsx,.pdf"
            disabled={parse.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelected(file);
              e.target.value = "";
            }}
            className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-primary file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary-foreground"
          />
          {parse.isPending && <p className="text-sm text-muted-foreground">Parsing file…</p>}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div>
          <p className="text-sm font-medium">Map columns</p>
          <p className="text-sm text-muted-foreground">
            Match each spreadsheet column to a BOQ field. Unmapped columns are ignored.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BOQ_COLUMN_FIELDS.map((field) => (
            <div key={field} className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{FIELD_LABELS[field]}</label>
              <Select
                value={mapping[field] ?? UNMAPPED}
                onValueChange={(value) =>
                  setMapping((prev) => ({ ...prev, [field]: value === UNMAPPED ? undefined : value }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Not mapped" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>Not mapped</SelectItem>
                  {preview.columns.map((column) => (
                    <SelectItem key={column} value={column}>
                      {column}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        <div className="max-h-72 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                {preview.columns.map((column) => (
                  <TableHead key={column}>{column}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {preview.rows.slice(0, 15).map((row) => (
                <TableRow key={row.rowIndex}>
                  {preview.columns.map((column) => (
                    <TableCell key={column}>{row.cells[column] ?? ""}</TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Showing {Math.min(15, preview.rows.length)} of {preview.rows.length} parsed rows.
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPreview(null)}>
            Start over
          </Button>
          <Button onClick={handleCommit} disabled={commit.isPending}>
            {commit.isPending ? "Committing…" : "Commit BOQ"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
