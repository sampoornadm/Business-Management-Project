"use client";

import {
  TENDER_CATEGORIES,
  TENDER_TYPES,
  type ApiResponse,
  type BoqDto,
  type CommitBoqItemInput,
  type ExtractedTenderItem,
  type TenderExtractionResultDto,
} from "@bmp/types";
import {
  Card,
  CardContent,
  CITIES_BY_STATE,
  INDIA_STATES,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  useToast,
  type IndiaState,
} from "@bmp/ui";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { TenderForm, toCreateTenderInput, type TenderFormValues } from "@/components/tenders/tender-form";
import { useCreateTender, useExtractTenderFromDocument } from "@/hooks/use-tenders";
import { apiClient } from "@/lib/axios";

// TENDER_TYPES/TENDER_CATEGORIES are curated suggestions, but tender-form.tsx
// renders them as a closed Radix <Select> (no free-text SelectItem) — passing
// through an extracted value with no matching option renders the Select
// blank rather than showing the placeholder (see CLAUDE.md's Radix Select
// sentinel gotcha), so only pre-fill on an exact case-insensitive match.
function matchCuratedOption(value: string | undefined, options: readonly string[]): string | undefined {
  if (!value) return undefined;
  return options.find((option) => option.toLowerCase() === value.toLowerCase());
}

// TENDER_CATEGORIES is a construction-industry taxonomy (civil/road/building/
// water supply) that doesn't have a clean match for industrial spare-parts
// procurement (flanges, gaskets, elbows...), so extraction never confidently
// hits one directly. This is a lightweight keyword fallback over the item/
// description text, not a real classifier — "OTHER" whenever nothing hits.
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  MECHANICAL: [
    "flange", "elbow", "gasket", "coupling", "nipple", "bearing", "valve",
    "pipe", "tube", "fitting", "nut", "bolt", "bracket", "seal", "hose",
  ],
  ELECTRICAL: ["cable", "wire", "motor", "transformer", "switch", "relay", "breaker", "panel", "lamp", "bulb"],
  CIVIL: ["cement", "concrete", "brick", "aggregate", "rebar", "reinforcement"],
  ROAD: ["bitumen", "asphalt"],
  BUILDING: ["paint", "varnish", "coating", "tile", "door", "window"],
  WATER_SUPPLY: ["pump"],
};

function inferCategory(text: string): string | undefined {
  const lower = text.toLowerCase();
  let best: { category: string; hits: number } | undefined;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const hits = keywords.filter((keyword) => lower.includes(keyword)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { category, hits };
  }
  return best?.category ?? "OTHER";
}

function toFormDefaults(result: TenderExtractionResultDto): Partial<TenderFormValues> {
  const { fields } = result;
  const defaults: Partial<TenderFormValues> = {};

  if (fields.tenderNumber) defaults.tenderNumber = fields.tenderNumber;
  if (fields.title) defaults.title = fields.title;
  if (fields.department) defaults.department = fields.department;
  if (fields.description) defaults.description = fields.description;
  if (fields.remarks) defaults.remarks = fields.remarks;
  if (fields.dealingOfficerName) defaults.dealingOfficerName = fields.dealingOfficerName;
  if (fields.dealingOfficerEmail) defaults.dealingOfficerEmail = fields.dealingOfficerEmail;
  if (fields.dealingOfficerPhone) defaults.dealingOfficerPhone = fields.dealingOfficerPhone;
  if (fields.estimatedCost !== undefined) defaults.estimatedCost = String(fields.estimatedCost);
  if (fields.emdAmount !== undefined) defaults.emdAmount = String(fields.emdAmount);
  if (fields.tenderFee !== undefined) defaults.tenderFee = String(fields.tenderFee);
  if (fields.documentFee !== undefined) defaults.documentFee = String(fields.documentFee);
  if (fields.validityPeriodDays !== undefined) {
    defaults.validityPeriodDays = String(fields.validityPeriodDays);
  }
  if (fields.submissionDate && /^\d{4}-\d{2}-\d{2}/.test(fields.submissionDate)) {
    defaults.submissionDate = fields.submissionDate.slice(0, 10);
  }
  if (fields.openingDate && /^\d{4}-\d{2}-\d{2}/.test(fields.openingDate)) {
    defaults.openingDate = fields.openingDate.slice(0, 10);
  }

  const type = matchCuratedOption(fields.type, TENDER_TYPES);
  if (type) defaults.type = type;

  const category =
    matchCuratedOption(fields.category, TENDER_CATEGORIES) ??
    inferCategory([fields.description, ...result.items.map((item) => item.description)].filter(Boolean).join(" "));
  if (category) defaults.category = category;

  // Location/state are now closed Selects (India state + city picker), so
  // pre-filling with an uncurated extracted value would hit the same
  // blank-Select gotcha noted above — only pre-fill on a curated match.
  const state = matchCuratedOption(fields.state, INDIA_STATES);
  if (state) defaults.state = state;
  const location = state ? matchCuratedOption(fields.location, CITIES_BY_STATE[state as IndiaState] ?? []) : undefined;
  if (location) defaults.location = location;

  if (result.suggestedClientId) defaults.clientId = result.suggestedClientId;

  return defaults;
}

export default function NewTenderPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createTender = useCreateTender();
  const extract = useExtractTenderFromDocument();

  const [defaultValues, setDefaultValues] = useState<Partial<TenderFormValues>>();
  const [formKey, setFormKey] = useState(0);
  const [hint, setHint] = useState<string>();
  const [suggestedClientName, setSuggestedClientName] = useState<string>();
  const [extractedItems, setExtractedItems] = useState<ExtractedTenderItem[]>([]);
  const [isCommittingItems, setIsCommittingItems] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(file: File) {
    setHint(undefined);
    try {
      const result = await extract.mutateAsync(file);
      setDefaultValues(toFormDefaults(result));
      setExtractedItems(result.items);
      // Bumping the key forces TenderForm (and its react-hook-form instance)
      // to remount, since RHF only reads defaultValues on mount.
      setFormKey((key) => key + 1);

      setSuggestedClientName(
        result.suggestedClientName && !result.suggestedClientId ? result.suggestedClientName : undefined,
      );

      const hints: string[] = [...result.warnings];
      if (result.suggestedClientName && !result.suggestedClientId) {
        hints.push(
          `Detected client "${result.suggestedClientName}" — select an existing organization or use "+ New organization" below.`,
        );
      }
      if (hints.length > 0) setHint(hints.join(" "));

      toast({
        title: "Fields extracted from document",
        description: "Review the pre-filled form before creating the tender.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not extract from document",
        description: error instanceof Error ? error.message : "Please try again or enter details manually.",
      });
    }
  }

  async function handleSubmit(values: TenderFormValues) {
    try {
      const tender = await createTender.mutateAsync(toCreateTenderInput(values));

      // Items extracted from a document are committed as the tender's first
      // BOQ right away — no separate upload/parse/commit trip. Rate is left
      // unset (no price is known yet); this is a second call, not one
      // transaction, so if it fails the tender still exists and the BOQ can
      // be added from its detail page's existing BOQ tab.
      if (extractedItems.length > 0) {
        setIsCommittingItems(true);
        try {
          const items: CommitBoqItemInput[] = extractedItems.map((item, index) => ({
            tempId: String(index),
            itemCode: item.itemCode,
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
          }));
          await apiClient.post<ApiResponse<BoqDto>>(`/tenders/${tender.id}/boq`, { items });
        } catch (error) {
          toast({
            variant: "destructive",
            title: "Tender created, but the items could not be saved",
            description:
              error instanceof Error
                ? error.message
                : "Add the BOQ from the tender's BOQ tab instead.",
          });
          router.push(`/tenders/${tender.id}`);
          return;
        } finally {
          setIsCommittingItems(false);
        }
      }

      toast({ title: "Tender created" });
      router.push(`/tenders/${tender.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create tender",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Tender</h1>
        <p className="text-sm text-muted-foreground">Create a new tender record.</p>
      </div>

      <Card>
        <CardContent className="space-y-3 pt-6">
          <p className="text-sm font-medium">Auto-fill from a tender document (optional)</p>
          <p className="text-sm text-muted-foreground">
            Upload a bid invitation / NIT (PDF or Word) to pre-fill the form below using a local AI model.
            Nothing is saved until you review and submit.
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!extract.isPending) setIsDraggingFile(true);
            }}
            onDragLeave={() => setIsDraggingFile(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDraggingFile(false);
              if (extract.isPending) return;
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFileSelected(file);
            }}
            onClick={() => !extract.isPending && fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-2 rounded-md border-2 border-dashed p-6 text-center transition-colors",
              isDraggingFile ? "border-primary bg-primary/5" : "border-muted-foreground/25",
              extract.isPending && "cursor-not-allowed opacity-60",
            )}
          >
            <p className="text-sm">
              Drag and drop a PDF or Word file here, or{" "}
              <span className="font-medium text-primary underline underline-offset-2">choose a file</span>
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx"
              disabled={extract.isPending}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileSelected(file);
                e.target.value = "";
              }}
              className="hidden"
            />
          </div>
          {extract.isPending && (
            <p className="text-sm text-muted-foreground">Extracting fields — this can take up to a minute…</p>
          )}
          {hint && <p className="text-sm text-amber-600 dark:text-amber-500">{hint}</p>}
        </CardContent>
      </Card>

      {extractedItems.length > 0 && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div>
              <p className="text-sm font-medium">Items found in document ({extractedItems.length})</p>
              <p className="text-sm text-muted-foreground">
                These will be saved as the tender&apos;s BOQ when you create the tender. No rate is
                set yet — price them once you have all the items in hand, from the tender&apos;s BOQ
                tab.
              </p>
            </div>
            <div className="max-h-72 overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {extractedItems.map((item, index) => (
                    <TableRow key={`${item.itemCode}-${index}`}>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{item.itemCode}</TableCell>
                      <TableCell className="max-w-md text-sm">{item.description}</TableCell>
                      <TableCell>{item.quantity ?? ""}</TableCell>
                      <TableCell>{item.unit ?? ""}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <TenderForm
        key={formKey}
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        isSubmitting={createTender.isPending || isCommittingItems}
        submitLabel="Create tender"
        suggestedClientName={suggestedClientName}
      />
    </div>
  );
}
