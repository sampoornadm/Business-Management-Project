"use client";

import type { BoqItemDto, HistoricalRateCategory, UpsertBoqItemRateAnalysisInput } from "@bmp/types";
import { HISTORICAL_RATE_CATEGORIES } from "@bmp/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Calculator } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useUpsertRateAnalysis } from "@/hooks/use-boq";
import { useSuggestRates } from "@/hooks/use-rates";

const numericField = z
  .string()
  .refine((value) => value === "" || !Number.isNaN(Number(value)), "Must be a number");

const schema = z.object({
  materialCost: numericField,
  laborCost: numericField,
  machineryCost: numericField,
  transportCost: numericField,
  overheadPercent: numericField,
  profitPercent: numericField,
  taxPercent: numericField,
});
type FormValues = z.infer<typeof schema>;

const COST_FIELD_BY_CATEGORY: Record<HistoricalRateCategory, keyof FormValues> = {
  MATERIAL: "materialCost",
  LABOR: "laborCost",
  MACHINERY: "machineryCost",
  TRANSPORT: "transportCost",
};

function num(value: string): number {
  return value === "" ? 0 : Number(value);
}

function computeRate(values: FormValues): number {
  const base = num(values.materialCost) + num(values.laborCost) + num(values.machineryCost) + num(values.transportCost);
  const rate =
    base *
    (1 + num(values.overheadPercent) / 100) *
    (1 + num(values.profitPercent) / 100) *
    (1 + num(values.taxPercent) / 100);
  return Math.round((rate + Number.EPSILON) * 100) / 100;
}

function toInput(values: FormValues): UpsertBoqItemRateAnalysisInput {
  return {
    materialCost: num(values.materialCost),
    laborCost: num(values.laborCost),
    machineryCost: num(values.machineryCost),
    transportCost: num(values.transportCost),
    overheadPercent: num(values.overheadPercent),
    profitPercent: num(values.profitPercent),
    taxPercent: num(values.taxPercent),
  };
}

function defaultsFor(item: BoqItemDto): FormValues {
  const breakdown = item.rateBreakdown;
  return {
    materialCost: String(breakdown?.materialCost ?? 0),
    laborCost: String(breakdown?.laborCost ?? 0),
    machineryCost: String(breakdown?.machineryCost ?? 0),
    transportCost: String(breakdown?.transportCost ?? 0),
    overheadPercent: String(breakdown?.overheadPercent ?? 0),
    profitPercent: String(breakdown?.profitPercent ?? 0),
    taxPercent: String(breakdown?.taxPercent ?? 0),
  };
}

const COST_FIELDS: Array<{ name: keyof FormValues; label: string }> = [
  { name: "materialCost", label: "Material cost" },
  { name: "laborCost", label: "Labor cost" },
  { name: "machineryCost", label: "Machinery cost" },
  { name: "transportCost", label: "Transport cost" },
  { name: "overheadPercent", label: "Overhead %" },
  { name: "profitPercent", label: "Profit %" },
  { name: "taxPercent", label: "Tax %" },
];

export function RateAnalysisDialog({ tenderId, item }: { tenderId: string; item: BoqItemDto }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [suggestCategory, setSuggestCategory] = useState<HistoricalRateCategory>("MATERIAL");
  const suggestions = useSuggestRates(open ? suggestCategory : undefined, item.description);
  const upsert = useUpsertRateAnalysis(tenderId);

  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaultsFor(item) });
  const computedRate = computeRate(form.watch());

  async function handleSubmit(values: FormValues) {
    try {
      await upsert.mutateAsync({ itemId: item.id, input: toInput(values) });
      toast({ title: "Rate analysis saved" });
      setOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not save rate analysis",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaultsFor(item));
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" title="Rate analysis">
          <Calculator className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rate analysis — {item.description}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {COST_FIELDS.map(({ name, label }) => (
                <FormField
                  key={name}
                  control={form.control}
                  name={name}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{label}</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ))}
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Computed rate: </span>
              <span className="font-semibold">{computedRate.toLocaleString()}</span>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">Suggested rates</p>
                <Select
                  value={suggestCategory}
                  onValueChange={(value) => setSuggestCategory(value as HistoricalRateCategory)}
                >
                  <SelectTrigger className="h-8 w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HISTORICAL_RATE_CATEGORIES.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {suggestions.isFetching && <p className="text-xs text-muted-foreground">Searching…</p>}
              {!suggestions.isFetching && (suggestions.data?.length ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground">No historical rates matched.</p>
              )}
              {suggestions.data?.map((suggestion) => (
                <div key={suggestion.id} className="flex items-center justify-between text-sm">
                  <span>
                    {suggestion.itemName} — {suggestion.rate.toLocaleString()}/{suggestion.unit} (
                    {new Date(suggestion.effectiveDate).toLocaleDateString()})
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      form.setValue(COST_FIELD_BY_CATEGORY[suggestCategory], String(suggestion.rate))
                    }
                  >
                    Use
                  </Button>
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={upsert.isPending}>
                {upsert.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
