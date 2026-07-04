"use client";

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, useToast } from "@bmp/ui";
import { Plus } from "lucide-react";
import { useState } from "react";

import { useCreateBankAccount } from "@/hooks/use-finance";

export function CreateBankAccountDialog() {
  const { toast } = useToast();
  const createAccount = useCreateBankAccount();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [openingBalance, setOpeningBalance] = useState("");

  async function handleSubmit() {
    if (!name.trim()) {
      toast({ variant: "destructive", title: "Name is required" });
      return;
    }
    try {
      await createAccount.mutateAsync({
        name: name.trim(),
        bankName: bankName.trim() || undefined,
        accountNumber: accountNumber.trim() || undefined,
        openingBalance: openingBalance ? Number(openingBalance) : undefined,
      });
      toast({ title: "Bank account created" });
      setOpen(false);
      setName("");
      setBankName("");
      setAccountNumber("");
      setOpeningBalance("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create bank account",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" /> Add bank account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add bank account</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Account name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          <Input
            placeholder="Account number"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
          />
          <Input
            type="number"
            placeholder="Opening balance"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={createAccount.isPending}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
