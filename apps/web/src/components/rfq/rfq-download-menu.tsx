"use client";

import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, useToast } from "@bmp/ui";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { downloadFile } from "@/lib/download";

export function RfqDownloadMenu({ rfqId }: { rfqId: string }) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function handle(path: string, filename: string) {
    setPending(true);
    try {
      await downloadFile(path, filename);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not download document",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" disabled={pending}>
          {pending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void handle(`/rfqs/${rfqId}/quote-sheet`, `quotes-${rfqId}.xlsx`)}>
          Quote sheet (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handle(`/rfqs/${rfqId}/documents/word`, `RFR-${rfqId}.docx`)}>
          Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void handle(`/rfqs/${rfqId}/documents/pdf`, `RFR-${rfqId}.pdf`)}>
          PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
