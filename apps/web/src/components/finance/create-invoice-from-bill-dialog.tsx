"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  useToast,
} from "@bmp/ui";
import { Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useCreateInvoiceFromBill } from "@/hooks/use-finance";

export function CreateInvoiceFromBillDialog({
  billId,
  suggestedInvoiceNumber,
}: {
  billId: string;
  suggestedInvoiceNumber: string;
}) {
  const { toast } = useToast();
  const createInvoice = useCreateInvoiceFromBill();
  const [open, setOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState(suggestedInvoiceNumber);
  const [clientName, setClientName] = useState("");

  async function handleSubmit() {
    if (!invoiceNumber.trim() || !clientName.trim()) {
      toast({ variant: "destructive", title: "Invoice number and client name are required" });
      return;
    }
    try {
      const invoice = await createInvoice.mutateAsync({
        billId,
        invoiceNumber: invoiceNumber.trim(),
        clientName: clientName.trim(),
      });
      toast({
        title: "Invoice created",
        description: (
          <Link href={`/finance/invoices/${invoice.id}`} className="underline">
            View invoice {invoice.invoiceNumber}
          </Link>
        ),
      });
      setOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create invoice",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Receipt className="mr-2 h-4 w-4" /> Create invoice
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create invoice from this bill</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Invoice number"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
          <Input placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={createInvoice.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
