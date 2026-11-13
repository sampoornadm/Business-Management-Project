"use client";

import { Card, CardContent, CardHeader, CardTitle, formatDate, formatMoney, PageHeader, PageSkeleton, useToast } from "@bmp/ui";
import { useParams } from "next/navigation";

import { RecordPaymentDialog } from "@/components/finance/record-payment-dialog";
import { StatusBadge } from "@/components/status-badge";
import { useExpense, useRecordExpensePayment } from "@/hooks/use-finance";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";

export default function ExpenseDetailPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const expenseQuery = useExpense(params.id);
  useBreadcrumbLabel(params.id, expenseQuery.data?.description);
  const recordPayment = useRecordExpensePayment(params.id);

  if (expenseQuery.isLoading || !expenseQuery.data) {
    return <PageSkeleton />;
  }

  const expense = expenseQuery.data;
  const remaining = expense.amount - expense.amountPaid;

  return (
    <div className="space-y-6">
      <PageHeader
        title={expense.description}
        badges={
          <>
            <StatusBadge status={expense.status} />
          </>
        }
        actions={
          <>
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
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {expense.category} · {formatDate(expense.expenseDate)}
        </p>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Amounts</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-muted-foreground">Amount</p>
            <p className="font-semibold">{formatMoney(expense.amount)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Paid</p>
            <p>{formatMoney(expense.amountPaid)}</p>
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {expense.payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <div>
                    <p className="font-medium">{formatMoney(payment.amount)}</p>
                    <p className="text-muted-foreground">
                      {payment.method} · {formatDate(payment.paymentDate)}
                      {payment.referenceNumber ? ` · ${payment.referenceNumber}` : ""}
                    </p>
                  </div>
                  <p className="text-muted-foreground">
                    {payment.recordedBy.firstName} {payment.recordedBy.lastName}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
