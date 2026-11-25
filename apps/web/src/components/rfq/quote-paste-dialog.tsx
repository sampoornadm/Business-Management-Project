"use client";

import type { QuotePastePreviewDto, QuotePastePreviewItemDto } from "@bmp/types";
import {
  AiBadge,
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  formatMoney,
  Input,
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
  Textarea,
  useToast,
} from "@bmp/ui";
import { MessageSquareText } from "lucide-react";
import { useState } from "react";

import { useParseQuoteText, useSaveQuotes } from "@/hooks/use-rfq";

/** One editable preview row. Rate kept as a string while typing (same rule as RHF numeric fields). */
interface Row extends QuotePastePreviewItemDto {
  rateText: string;
}

function toRows(preview: QuotePastePreviewDto): Row[] {
  return preview.items.map((item) => ({ ...item, rateText: item.rate === null ? "" : String(item.rate) }));
}

/** A row is saved when it carries a positive rate or a regret; untouched rows keep their old quote. */
function rowToSave(row: Row): { rfqItemId: string; rate?: number; regretted?: boolean } | null {
  if (row.regretted) return { rfqItemId: row.rfqItemId, regretted: true };
  const rate = Number(row.rateText);
  return row.rateText.trim() !== "" && rate > 0 ? { rfqItemId: row.rfqItemId, rate } : null;
}

function SourceBadge({ source }: { source: QuotePastePreviewItemDto["source"] }) {
  if (source === "ai") return <AiBadge>AI</AiBadge>;
  if (source === "serial") return <Badge variant="outline">Serial</Badge>;
  if (source === "description") return <Badge variant="outline">Description</Badge>;
  return null;
}

export function QuotePasteDialog({ rfqId, vendors }: { rfqId: string; vendors: { id: string; name: string }[] }) {
  const { toast } = useToast();
  const parse = useParseQuoteText(rfqId);
  const save = useSaveQuotes(rfqId);
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<QuotePastePreviewDto | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  const toSave = rows.map((row) => ({ row, quote: rowToSave(row) })).filter((r) => r.quote !== null);

  function reset() {
    setVendorId("");
    setText("");
    setPreview(null);
    setRows([]);
  }

  function updateRow(rfqItemId: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.rfqItemId === rfqItemId ? { ...row, ...patch } : row)));
  }

  async function readRates() {
    try {
      const result = await parse.mutateAsync({ vendorId, text });
      setPreview(result);
      setRows(toRows(result));
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not read the message",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function saveQuotes() {
    try {
      const result = await save.mutateAsync({
        vendorId,
        quotes: toSave.map((r) => r.quote!),
        aiCount: toSave.filter((r) => r.row.source === "ai").length,
      });
      toast({ title: `Saved ${result.imported} quote(s)` });
      setOpen(false);
      reset();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save quotes",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (vendors.length === 0) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <MessageSquareText className="mr-2 h-4 w-4" /> Paste text quote
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paste text quote</DialogTitle>
          <DialogDescription>
            Paste the vendor&apos;s reply. Lines are matched to items by serial number or description; anything
            unclear goes to the AI reader. Nothing is saved until you review it.
          </DialogDescription>
        </DialogHeader>

        {preview === null ? (
          <div className="space-y-3">
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger className="w-72">
                <SelectValue placeholder="Vendor who sent it" />
              </SelectTrigger>
              <SelectContent>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Textarea
              className="min-h-[280px] font-mono text-xs"
              placeholder={"1) Item description - Qty - 150 EA - 10/-\n2) Item description - Qty - 20 Mtr - regret\n…"}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={20_000}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {preview.gstNotice && (
              <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                {preview.gstNotice}
              </p>
            )}
            {preview.aiNotice && (
              <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">{preview.aiNotice}</p>
            )}
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Sl No</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">RFQ qty</TableHead>
                    <TableHead>Vendor line</TableHead>
                    <TableHead className="w-32">Rate</TableHead>
                    <TableHead className="w-16">Regret</TableHead>
                    <TableHead>Matched by</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const changed =
                      row.currentRate !== null && !row.regretted && row.rateText !== "" && Number(row.rateText) !== row.currentRate;
                    return (
                      <TableRow key={row.rfqItemId}>
                        <TableCell>{row.slNo}</TableCell>
                        <TableCell className="max-w-xs">
                          <p className="line-clamp-2 text-sm">{row.description}</p>
                          {row.warnings.map((w) => (
                            <p key={w} className="text-xs text-amber-700 dark:text-amber-400">
                              {w}
                            </p>
                          ))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.quantity} {row.unit ?? ""}
                        </TableCell>
                        <TableCell className="max-w-[16rem]">
                          <p className="truncate text-xs text-muted-foreground" title={row.vendorLine ?? undefined}>
                            {row.vendorLine ?? "—"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <Input
                            inputMode="decimal"
                            className="h-8"
                            aria-label={`Rate for item ${row.slNo}`}
                            value={row.rateText}
                            disabled={row.regretted}
                            onChange={(e) => updateRow(row.rfqItemId, { rateText: e.target.value })}
                          />
                          {changed && (
                            <p className="text-xs text-muted-foreground line-through">{formatMoney(row.currentRate)}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Checkbox
                            aria-label={`Regret for item ${row.slNo}`}
                            checked={row.regretted}
                            onCheckedChange={(checked) =>
                              updateRow(row.rfqItemId, checked === true ? { regretted: true, rateText: "" } : { regretted: false })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <SourceBadge source={row.source} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {preview.unmatchedLines.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium">Lines not matched to any item</p>
                {preview.unmatchedLines.map((line) => (
                  <p key={line.lineIndex} className="font-mono text-xs text-muted-foreground">
                    {line.text} <span className="font-sans">— {line.reason}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {preview === null ? (
            <>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button disabled={!vendorId || text.trim() === "" || parse.isPending} onClick={() => void readRates()}>
                {parse.isPending ? "Reading…" : "Read rates"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setPreview(null)}>
                Edit message
              </Button>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button disabled={toSave.length === 0 || save.isPending} onClick={() => void saveQuotes()}>
                {save.isPending ? "Saving…" : `Save ${toSave.length} quotes`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
