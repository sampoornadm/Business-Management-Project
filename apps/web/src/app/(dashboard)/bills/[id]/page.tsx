"use client";

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, formatDate, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, useToast } from "@bmp/ui";
import { Download } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { useBill } from "@/hooks/use-bills";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";
import { downloadFile } from "@/lib/download";

export default function BillDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const billQuery = useBill(params.id);
  useBreadcrumbLabel(params.id, billQuery.data?.billNumber);

  if (billQuery.isLoading || !billQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const bill = billQuery.data;

  async function handleDownload() {
    try {
      await downloadFile(`/bills/${bill.id}/pdf`, `${bill.billNumber}.pdf`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not download PDF",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{bill.billNumber}</h1>
          <p className="text-sm text-muted-foreground">
            {formatDate(bill.billDate)} ·{" "}
            <Link href={`/tenders/${bill.tenderId}`} className="hover:underline">
              {bill.tenderTitle}
            </Link>{" "}
            · {bill.clientName}
          </p>
        </div>
        <Button variant="outline" onClick={() => void handleDownload()}>
          <Download className="mr-2 h-4 w-4" /> Download PDF
        </Button>
      </div>

      {bill.grnNumber && (
        <div className="text-sm">
          <Badge variant="outline">GRN</Badge>{" "}
          {bill.grnNumber}
          {bill.grnDate ? ` dated ${formatDate(bill.grnDate)}` : ""}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bill.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.description}</TableCell>
                  <TableCell>{item.unit ?? "-"}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{item.rate.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {item.amount.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="mt-4 text-right text-lg font-semibold">
            Total: {bill.total.toLocaleString()}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
