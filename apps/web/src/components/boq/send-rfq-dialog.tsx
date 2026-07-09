"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
} from "@bmp/ui";
import { useEffect, useState, type ReactNode } from "react";

import { usePreviewQuickSendRfq, useQuickSendRfq } from "@/hooks/use-rfq";
import { useVendors } from "@/hooks/use-vendors";

export interface SendRfqDialogProps {
  trigger: ReactNode;
  tenderId?: string;
  boqItemIds: string[];
  suggestedVendorId?: string;
  onSent?: () => void;
}

// Preview-then-send: picking/changing the vendor regenerates the text (the
// user can still edit it before sending); the server never regenerates the
// text once "Send" is clicked — it emails exactly what's in the textarea.
export function SendRfqDialog({ trigger, tenderId, boqItemIds, suggestedVendorId, onSent }: SendRfqDialogProps) {
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [text, setText] = useState("");
  const [vendorContactEmail, setVendorContactEmail] = useState("");
  const { toast } = useToast();
  const vendorsQuery = useVendors({ page: 1, pageSize: 100, isActive: true });
  const preview = usePreviewQuickSendRfq();
  const send = useQuickSendRfq();

  useEffect(() => {
    if (open) {
      setVendorId(suggestedVendorId ?? "");
      setText("");
      setVendorContactEmail("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !vendorId) return;
    let cancelled = false;
    preview
      .mutateAsync({ tenderId, boqItemIds, vendorId })
      .then((result) => {
        if (cancelled) return;
        setText(result.text);
        setVendorContactEmail(result.vendorContactEmail);
      })
      .catch((error) => {
        if (cancelled) return;
        toast({
          variant: "destructive",
          title: "Could not generate preview",
          description: error instanceof Error ? error.message : "Please try again.",
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendorId]);

  async function handleSend() {
    if (!vendorId) {
      toast({ variant: "destructive", title: "Select a vendor" });
      return;
    }
    try {
      await send.mutateAsync({ tenderId, boqItemIds, vendorId, text });
      toast({ title: "RFQ sent" });
      setOpen(false);
      onSent?.();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not send RFQ",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send RFQ</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Vendor</label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a vendor" />
              </SelectTrigger>
              <SelectContent>
                {(vendorsQuery.data?.items ?? []).map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {vendorId && (
            <div className="space-y-1">
              <label className="text-sm font-medium">To</label>
              <p className="text-sm text-muted-foreground">
                {preview.isPending ? "Loading…" : vendorContactEmail || "-"}
              </p>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-sm font-medium">Message</label>
            <Textarea
              rows={12}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={preview.isPending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSend} disabled={send.isPending || preview.isPending || !vendorId}>
            {send.isPending ? "Sending…" : "Send"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
