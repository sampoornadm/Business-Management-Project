"use client";

import { BILL_STATUS_TRANSITIONS, type BillStatus } from "@bmp/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bmp/ui";
import { Plus } from "lucide-react";
import { useState } from "react";

import { CreateInvoiceFromBillDialog } from "@/components/finance/create-invoice-from-bill-dialog";
import { useAddBill, useBills, useUpdateBillStatus } from "@/hooks/use-projects";

const STATUS_VARIANT: Record<BillStatus, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  SUBMITTED: "secondary",
  APPROVED: "secondary",
  PAID: "default",
};

function AddBillDialog({ projectId, lastCumulative }: { projectId: string; lastCumulative: number }) {
  const { toast } = useToast();
  const addBill = useAddBill(projectId);
  const [open, setOpen] = useState(false);
  const [billNumber, setBillNumber] = useState("");
  const [cumulativeAmount, setCumulativeAmount] = useState("");

  const preview =
    cumulativeAmount && Number(cumulativeAmount) >= lastCumulative
      ? Number(cumulativeAmount) - lastCumulative
      : null;

  async function handleSubmit() {
    if (!billNumber.trim() || !cumulativeAmount) {
      toast({ variant: "destructive", title: "Bill number and cumulative amount are required" });
      return;
    }
    try {
      await addBill.mutateAsync({ billNumber: billNumber.trim(), cumulativeAmount: Number(cumulativeAmount) });
      toast({ title: "Bill created" });
      setOpen(false);
      setBillNumber("");
      setCumulativeAmount("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create bill",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" /> Create bill
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create progress bill</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Bill number (e.g. RA-3)" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
          <Input
            type="number"
            placeholder="Cumulative work done so far"
            value={cumulativeAmount}
            onChange={(e) => setCumulativeAmount(e.target.value)}
          />
          <p className="text-sm text-muted-foreground">
            Previous cumulative: {lastCumulative.toLocaleString()}
            {preview !== null && ` · This bill's amount: ${preview.toLocaleString()}`}
          </p>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={addBill.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BillsTab({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const billsQuery = useBills(projectId);
  const updateStatus = useUpdateBillStatus(projectId);
  const bills = billsQuery.data ?? [];
  const lastCumulative = bills.at(-1)?.cumulativeAmount ?? 0;

  async function advance(billId: string, nextStatus: BillStatus) {
    try {
      await updateStatus.mutateAsync({ billId, input: { status: nextStatus } });
      toast({ title: `Bill moved to ${nextStatus}` });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update bill status",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex justify-end">
          <AddBillDialog projectId={projectId} lastCumulative={lastCumulative} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bill #</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Cumulative</TableHead>
              <TableHead className="text-right">This Bill</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-40" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No bills yet.
                </TableCell>
              </TableRow>
            ) : (
              bills.map((bill) => {
                const nextStatuses = BILL_STATUS_TRANSITIONS[bill.status];
                return (
                  <TableRow key={bill.id}>
                    <TableCell>{bill.billNumber}</TableCell>
                    <TableCell>{new Date(bill.billDate).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">{bill.cumulativeAmount.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{bill.currentBillAmount.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[bill.status]}>{bill.status}</Badge>
                    </TableCell>
                    <TableCell className="space-x-2">
                      {nextStatuses.length > 0 && (
                        <Button size="sm" variant="outline" onClick={() => advance(bill.id, nextStatuses[0]!)}>
                          Mark {nextStatuses[0]}
                        </Button>
                      )}
                      {bill.status !== "DRAFT" && (
                        <CreateInvoiceFromBillDialog
                          billId={bill.id}
                          suggestedInvoiceNumber={`INV-${bill.billNumber}`}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
