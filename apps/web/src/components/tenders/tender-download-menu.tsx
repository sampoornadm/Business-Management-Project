"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  useToast,
} from "@bmp/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";

import { downloadQuotation, downloadUndertaking } from "@/hooks/use-document-generation";

export function TenderDownloadMenu({
  tenderId,
  tenderNumber,
  size = "default",
  iconOnly = false,
}: {
  tenderId: string;
  tenderNumber: string;
  size?: "default" | "sm" | "icon";
  iconOnly?: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(false);

  // The server saves every generated undertaking/quotation as a tender Attachment, so the
  // Documents tab (and its checklist) must refetch or the new file only appears after a reload.
  function refreshTenderDocuments() {
    void queryClient.invalidateQueries({ queryKey: ["tenders", tenderId, "documents"] });
    void queryClient.invalidateQueries({ queryKey: ["tenders", tenderId, "document-checklist"] });
  }

  async function handle(action: () => Promise<void>) {
    setPending(true);
    try {
      await action();
      refreshTenderDocuments();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not generate document",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} disabled={pending} title={iconOnly ? "Download" : undefined}>
          {pending ? (
            <Loader2 className={iconOnly ? "h-4 w-4 animate-spin" : "mr-2 h-4 w-4 animate-spin"} />
          ) : (
            <Download className={iconOnly ? "h-4 w-4" : "mr-2 h-4 w-4"} />
          )}
          {iconOnly ? null : "Download"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Undertaking</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => void handle(() => downloadUndertaking(tenderId, tenderNumber, "pdf"))}>
              PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handle(() => downloadUndertaking(tenderId, tenderNumber, "docx"))}>
              Word (.docx)
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Quotation</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => void handle(() => downloadQuotation(tenderId, tenderNumber, "docx"))}>
              Word (.docx)
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handle(() => downloadQuotation(tenderId, tenderNumber, "csv"))}>
              CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void handle(() => downloadQuotation(tenderId, tenderNumber, "pdf"))}>
              PDF
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
