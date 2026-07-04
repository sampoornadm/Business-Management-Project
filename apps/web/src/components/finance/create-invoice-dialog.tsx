"use client";

import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, Input, useToast } from "@bmp/ui";
import { Plus } from "lucide-react";
import { useState } from "react";

import { useCreateInvoice } from "@/hooks/use-finance";

export function CreateInvoiceDialog() {
  const { toast } = useToast();
  const createInvoice = useCreateInvoice();
  const [open, setOpen] = useState(false);
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [clientName, setClientName] = useState("");
  const [subtotal, setSubtotal] = useState("");
  const [gstPercent, setGstPercent] = useState("18");

  async function handleSubmit() {
    if (!invoiceNumber.trim() || !clientName.trim() || !subtotal) {
      toast({ variant: "destructive", title: "Invoice number, client, and subtotal are required" });
      return;
    }
    try {
      await createInvoice.mutateAsync({
        invoiceNumber: invoiceNumber.trim(),
        clientName: clientName.trim(),
        subtotal: Number(subtotal),
        gstPercent: gstPercent ? Number(gstPercent) : undefined,
      });
      toast({ title: "Invoice created" });
      setOpen(false);
      setInvoiceNumber("");
      setClientName("");
      setSubtotal("");
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
          <Plus className="mr-2 h-4 w-4" /> Create invoice
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create invoice</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Invoice number"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
          />
          <Input placeholder="Client name" value={clientName} onChange={(e) => setClientName(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              placeholder="Subtotal"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value)}
            />
            <Input
              type="number"
              placeholder="GST %"
              value={gstPercent}
              onChange={(e) => setGstPercent(e.target.value)}
            />
          </div>
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
