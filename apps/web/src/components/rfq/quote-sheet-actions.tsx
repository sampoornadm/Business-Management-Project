"use client";

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
import { Upload } from "lucide-react";
import { useRef, useState } from "react";

import { RfqDownloadMenu } from "@/components/rfq/rfq-download-menu";
import { useImportQuotes } from "@/hooks/use-rfq";

export function QuoteSheetActions({
  rfqId,
  vendors,
}: {
  rfqId: string;
  vendors: { id: string; name: string }[];
}) {
  const { toast } = useToast();
  const [vendorId, setVendorId] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const importQuotes = useImportQuotes(rfqId);

  async function onFile(file: File) {
    try {
      const result = await importQuotes.mutateAsync({ vendorId, file });
      toast({
        title: `Imported ${result.imported} quote(s)`,
        // Surface per-row problems rather than reporting a clean success over them.
        ...(result.errors.length > 0
          ? { variant: "destructive" as const, description: result.errors.slice(0, 3).join("; ") }
          : {}),
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not import quotes",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <RfqDownloadMenu rfqId={rfqId} />

      {vendors.length > 0 && (
        <>
          <Select value={vendorId} onValueChange={setVendorId}>
            <SelectTrigger className="h-9 w-56">
              <SelectValue placeholder="Vendor to import for" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            ref={fileInput}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onFile(file);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            disabled={!vendorId || importQuotes.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="mr-2 h-4 w-4" /> Import filled sheet
          </Button>
        </>
      )}
    </div>
  );
}
