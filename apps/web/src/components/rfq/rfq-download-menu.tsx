"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@bmp/ui";
import { Download } from "lucide-react";

import { downloadFile } from "@/lib/download";

export function RfqDownloadMenu({ rfqId }: { rfqId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline">
          <Download className="mr-2 h-4 w-4" /> Download
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => void downloadFile(`/rfqs/${rfqId}/quote-sheet`, `quotes-${rfqId}.xlsx`)}
        >
          Quote sheet (.xlsx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void downloadFile(`/rfqs/${rfqId}/documents/word`, `RFR-${rfqId}.docx`)}
        >
          Word (.docx)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => void downloadFile(`/rfqs/${rfqId}/documents/pdf`, `RFR-${rfqId}.pdf`)}
        >
          PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
