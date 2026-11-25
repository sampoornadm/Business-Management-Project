"use client";

import type { AdditionalChargeDto, AdditionalChargeInput, UpdateAdditionalChargeInput } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  confirmAction,
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
  useToast,
} from "@bmp/ui";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

/** Radix Select can't hold "" as an item value; this stands for "our own cost" (vendorId null). */
const OWN = "__own__";

interface Mutation<TInput> {
  mutateAsync: (input: TInput) => Promise<unknown>;
  isPending: boolean;
}

export interface ChargeMutations {
  add: Mutation<AdditionalChargeInput>;
  update: Mutation<UpdateAdditionalChargeInput & { id: string }>;
  remove: Mutation<string>;
}

interface AdditionalChargesCardProps {
  charges: AdditionalChargeDto[];
  mutations: ChargeMutations;
  editable: boolean;
  /** RFQ only: invited vendors a charge can be quoted by. Omitted = charges are added as our own. */
  vendors?: { id: string; name: string }[];
  /** One line under the title explaining where these charges go next. */
  description: string;
}

/**
 * Whole-RFQ / whole-tender costs (test certificates, delivery, P&F...). Ticked "Add to item rates"
 * spreads a charge into the item rates by item value; unticked keeps it as its own quotation line.
 */
export function AdditionalChargesCard({ charges, mutations, editable, vendors, description }: AdditionalChargesCardProps) {
  const { toast } = useToast();
  const [newDescription, setNewDescription] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newVendor, setNewVendor] = useState(OWN);
  const [newAddToRates, setNewAddToRates] = useState(true);

  const spread = charges.filter((c) => c.addToRates).reduce((sum, c) => sum + c.amount, 0);
  const separate = charges.filter((c) => !c.addToRates).reduce((sum, c) => sum + c.amount, 0);

  async function run(action: () => Promise<unknown>, failTitle: string) {
    try {
      await action();
      return true;
    } catch (error) {
      toast({
        variant: "destructive",
        title: failTitle,
        description: error instanceof Error ? error.message : "Please try again.",
      });
      return false;
    }
  }

  async function handleAdd() {
    const amount = Number(newAmount);
    if (!newDescription.trim() || !(amount > 0)) {
      toast({ variant: "destructive", title: "Enter a description and an amount above zero" });
      return;
    }
    const added = await run(
      () =>
        mutations.add.mutateAsync({
          description: newDescription.trim(),
          amount,
          addToRates: newAddToRates,
          ...(vendors ? { vendorId: newVendor === OWN ? null : newVendor } : {}),
        }),
      "Could not add charge",
    );
    if (added) {
      setNewDescription("");
      setNewAmount("");
    }
  }

  async function handleAmountBlur(charge: AdditionalChargeDto, raw: string) {
    const amount = Number(raw);
    if (amount === charge.amount) return;
    if (!(amount > 0)) {
      toast({ variant: "destructive", title: "Amount must be above zero" });
      return;
    }
    await run(() => mutations.update.mutateAsync({ id: charge.id, amount }), "Could not update charge");
  }

  async function handleDelete(charge: AdditionalChargeDto) {
    const confirmed = await confirmAction({
      title: "Delete this charge?",
      description: `"${charge.description}" (${formatMoney(charge.amount)}) will be removed.`,
      confirmLabel: "Delete charge",
      destructive: true,
    });
    if (confirmed) await run(() => mutations.remove.mutateAsync(charge.id), "Could not delete charge");
  }

  if (!editable && charges.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Additional charges</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {charges.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead className="w-40 text-right">Amount</TableHead>
                  <TableHead className="w-40">Add to item rates</TableHead>
                  {editable && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {charges.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell>{charge.description}</TableCell>
                    <TableCell className="text-muted-foreground">{charge.vendorName ?? "Own"}</TableCell>
                    <TableCell className="text-right">
                      {editable ? (
                        <Input
                          // Re-mounted on refetch so a saved amount replaces what was typed.
                          key={`${charge.id}-${charge.amount}`}
                          type="number"
                          min={0}
                          step="0.01"
                          className="ml-auto h-8 w-32 text-right"
                          defaultValue={charge.amount}
                          aria-label={`Amount for ${charge.description}`}
                          onBlur={(e) => void handleAmountBlur(charge, e.target.value)}
                        />
                      ) : (
                        formatMoney(charge.amount)
                      )}
                    </TableCell>
                    <TableCell>
                      <Checkbox
                        checked={charge.addToRates}
                        disabled={!editable || mutations.update.isPending}
                        aria-label={`Add ${charge.description} to item rates`}
                        onCheckedChange={(checked) =>
                          void run(
                            () => mutations.update.mutateAsync({ id: charge.id, addToRates: checked === true }),
                            "Could not update charge",
                          )
                        }
                      />
                    </TableCell>
                    {editable && (
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${charge.description}`}
                          disabled={mutations.remove.isPending}
                          onClick={() => void handleDelete(charge)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {charges.length > 0 && (
          <p className="text-sm text-muted-foreground">
            Spread into item rates: <span className="font-medium text-foreground">{formatMoney(spread)}</span> · Kept
            separate: <span className="font-medium text-foreground">{formatMoney(separate)}</span>
          </p>
        )}

        {editable && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
            <div className="min-w-[14rem] flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="e.g. Material test certificates, Delivery, P&F"
              />
            </div>
            {vendors && (
              <div className="w-48 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">From</label>
                <Select value={newVendor} onValueChange={setNewVendor}>
                  <SelectTrigger aria-label="Charge from">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={OWN}>Own</SelectItem>
                    {vendors.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="w-32 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Amount (₹)</label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                placeholder="0"
              />
            </div>
            <label className="flex h-10 items-center gap-2 text-sm">
              <Checkbox checked={newAddToRates} onCheckedChange={(checked) => setNewAddToRates(checked === true)} />
              Add to item rates
            </label>
            <Button variant="outline" onClick={() => void handleAdd()} disabled={mutations.add.isPending}>
              <Plus className="mr-2 h-4 w-4" /> Add charge
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
