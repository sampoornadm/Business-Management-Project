"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton, useToast } from "@bmp/ui";
import { useParams } from "next/navigation";

import { RecordPaymentDialog } from "@/components/finance/record-payment-dialog";
import { useExpense, useRecordExpensePayment } from "@/hooks/use-finance";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  UNPAID: "outline",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
};

export default function ExpenseDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const expenseQuery = useExpense(params.id);
  const recordPayment = useRecordExpensePayment(params.id);

  if (expenseQuery.isLoading || !expenseQuery.data) {
    return <Skeleton className="h-64 w-full max-w-3xl" />;
  }

  const expense = expenseQuery.data;
  const remaining = expense.amount - expense.amountPaid;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{expense.description}</h1>
            <Badge variant={STATUS_VARIANT[expense.status]}>{expense.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {expense.category} · {new Date(expense.expenseDate).toLocaleDateString()}
          </p>
        </div>
        {remaining > 0 && (
          <RecordPaymentDialog
            remainingAmount={remaining}
            isSubmitting={recordPayment.isPending}
            onSubmit={async (input) => {
              await recordPayment.mutateAsync(input);
              toast({ title: "Payment recorded" });
            }}
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Amounts</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Amount</p>
            <p className="font-semibold">{expense.amount.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Paid</p>
            <p>{expense.amountPaid.toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {expense.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            expense.payments.map((payment) => (
              <div key={payment.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                <div>
                  <p className="font-medium">{payment.amount.toLocaleString()}</p>
                  <p className="text-muted-foreground">
                    {payment.method} · {new Date(payment.paymentDate).toLocaleDateString()}
                    {payment.referenceNumber ? ` · ${payment.referenceNumber}` : ""}
                  </p>
                </div>
                <p className="text-muted-foreground">
                  {payment.recordedBy.firstName} {payment.recordedBy.lastName}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
