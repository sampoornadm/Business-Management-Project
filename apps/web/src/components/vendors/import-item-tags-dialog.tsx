"use client";

import type { ImportVendorItemTagsResult } from "@bmp/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useToast,
} from "@bmp/ui";
import { useRef, useState, type ReactNode } from "react";

import { useImportVendorItemTags } from "@/hooks/use-vendors";

export interface ImportItemTagsDialogProps {
  trigger: ReactNode;
}

// Bulk-imports "which vendor sells what item type/make" from an Excel file
// (columns: Vendor Name, Item Type, Make) — this is what powers RFQ vendor
// suggestions. Vendors are matched by exact name; unmatched rows are
// reported back rather than silently creating new vendors from a typo.
export function ImportItemTagsDialog({ trigger }: ImportItemTagsDialogProps) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ImportVendorItemTagsResult>();
  const { toast } = useToast();
  const importItemTags = useImportVendorItemTags();
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(file: File) {
    setResult(undefined);
    try {
      const importResult = await importItemTags.mutateAsync(file);
      setResult(importResult);
      toast({ title: `Imported ${importResult.imported} item tag(s)` });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not import item tags",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setResult(undefined);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import vendor item tags</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">
            Upload an Excel (.xlsx) file with columns <strong>Vendor Name</strong>,{" "}
            <strong>Item Type</strong>, and an optional <strong>Make</strong>. Vendor names must match
            an existing vendor exactly — unmatched rows are reported below, not created as new vendors.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            disabled={importItemTags.isPending}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFileSelected(file);
              e.target.value = "";
            }}
            className="block w-full text-sm"
          />
          {importItemTags.isPending && <p className="text-muted-foreground">Importing…</p>}
          {result && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="font-medium">{result.imported} tag(s) imported</p>
              {result.skipped.length > 0 && (
                <div className="space-y-1">
                  <p className="text-amber-600 dark:text-amber-500">{result.skipped.length} row(s) skipped:</p>
                  <ul className="list-inside list-disc space-y-0.5 text-muted-foreground">
                    {result.skipped.map((row) => (
                      <li key={row.row}>
                        Row {row.row} ({row.vendorName}): {row.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
