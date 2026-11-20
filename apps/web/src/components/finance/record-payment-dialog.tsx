"use client";

import { PAYMENT_METHODS } from "@bmp/types";
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
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
  useToast,
} from "@bmp/ui";
import { CircleDollarSign } from "lucide-react";
import { useState } from "react";

import { useBankAccounts } from "@/hooks/use-finance";

export function RecordPaymentDialog({
  remainingAmount,
  onSubmit,
  isSubmitting,
  closeOption,
}: {
  remainingAmount: number;
  onSubmit: (input: {
    amount: number;
    method: (typeof PAYMENT_METHODS)[number];
    bankAccountId?: string;
    referenceNumber?: string;
    /** Only sent when `closeOption` is set: whether this payment closes the account. */
    close?: boolean;
  }) => Promise<void>;
  isSubmitting?: boolean;
  /** Label of an optional "this closes it" checkbox (checked by default), e.g. "Payment complete". */
  closeOption?: string;
}) {
  const { toast } = useToast();
  const bankAccountsQuery = useBankAccounts(true);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(remainingAmount));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("CASH");
  const [bankAccountId, setBankAccountId] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [close, setClose] = useState(true);

  async function handleSubmit() {
    const parsedAmount = Number(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      toast({ variant: "destructive", title: "Enter a valid amount" });
      return;
    }
    if (method !== "CASH" && !bankAccountId) {
      toast({ variant: "destructive", title: "Select a bank account for non-cash payments" });
      return;
    }
    try {
      await onSubmit({
        amount: parsedAmount,
        method,
        bankAccountId: method === "CASH" ? undefined : bankAccountId,
        referenceNumber: referenceNumber || undefined,
        ...(closeOption ? { close } : {}),
      });
      setOpen(false);
      setReferenceNumber("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not record payment",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <CircleDollarSign className="mr-2 h-4 w-4" /> Record payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Amount</label>
            <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="text-xs text-muted-foreground">Remaining: {formatMoney(remainingAmount)}</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Method</label>
            <Select value={method} onValueChange={(v) => setMethod(v as (typeof PAYMENT_METHODS)[number])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAYMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {method !== "CASH" && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Bank account</label>
              <Select value={bankAccountId} onValueChange={setBankAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a bank account" />
                </SelectTrigger>
                <SelectContent>
                  {(bankAccountsQuery.data ?? []).map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium">Reference number (optional)</label>
            <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} />
          </div>
          {closeOption && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={close} onCheckedChange={(checked) => setClose(checked === true)} />
              {closeOption}
            </label>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={isSubmitting}>
            {isSubmitting ? "Recording…" : "Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
