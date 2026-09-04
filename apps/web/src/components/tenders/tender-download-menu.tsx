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
import { Download } from "lucide-react";

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

  async function handle(action: () => Promise<void>) {
    try {
      await action();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not generate document",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size}>
          <Download className={iconOnly ? "h-4 w-4" : "mr-2 h-4 w-4"} />
          {iconOnly ? null : "Download"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void handle(() => downloadUndertaking(tenderId, tenderNumber))}>
          Undertaking
        </DropdownMenuItem>
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
