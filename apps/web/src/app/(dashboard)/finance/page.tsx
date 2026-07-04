"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from "@bmp/ui";
import Link from "next/link";

import { CreateBankAccountDialog } from "@/components/finance/create-bank-account-dialog";
import { CreateExpenseDialog } from "@/components/finance/create-expense-dialog";
import { CreateInvoiceDialog } from "@/components/finance/create-invoice-dialog";
import { useBankAccounts, useExpenses, useFinanceSummary, useInvoices } from "@/hooks/use-finance";

const INVOICE_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  SENT: "secondary",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
  OVERDUE: "destructive",
};

const EXPENSE_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  UNPAID: "outline",
  PARTIALLY_PAID: "secondary",
  PAID: "default",
};

export default function FinancePage() {
  const summaryQuery = useFinanceSummary();
  const invoicesQuery = useInvoices({ page: 1, pageSize: 20 });
  const expensesQuery = useExpenses({ page: 1, pageSize: 20 });
  const bankAccountsQuery = useBankAccounts();

  return (
    <div className="max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground">
          Invoices, expenses, payments, and cash/bank balances.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Receivables</p>
            <p className="text-2xl font-semibold">{summaryQuery.data?.totalReceivables.toLocaleString() ?? "-"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Payables</p>
            <p className="text-2xl font-semibold">{summaryQuery.data?.totalPayables.toLocaleString() ?? "-"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Cash balance</p>
            <p className="text-2xl font-semibold">{summaryQuery.data?.cashBalance.toLocaleString() ?? "-"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Bank balances</p>
            {(summaryQuery.data?.bankBalances ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No bank accounts</p>
            ) : (
              (summaryQuery.data?.bankBalances ?? []).map((b) => (
                <p key={b.bankAccountId} className="text-sm">
                  {b.name}: {b.balance.toLocaleString()}
                </p>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="invoices">
        <TabsList>
          <TabsTrigger value="invoices">Invoices</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="bank-accounts">Bank Accounts</TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Invoices</CardTitle>
              <CreateInvoiceDialog />
            </CardHeader>
            <CardContent className="space-y-2">
              {(invoicesQuery.data?.items ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices yet.</p>
              ) : (
                (invoicesQuery.data?.items ?? []).map((invoice) => (
                  <Link
                    key={invoice.id}
                    href={`/finance/invoices/${invoice.id}`}
                    className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"
                  >
                    <div>
                      <p className="font-medium">
                        {invoice.invoiceNumber} — {invoice.clientName}
                      </p>
                      <p className="text-muted-foreground">
                        {invoice.amountPaid.toLocaleString()} / {invoice.totalAmount.toLocaleString()} paid
                      </p>
                    </div>
                    <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]}>{invoice.status}</Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expenses">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Expenses</CardTitle>
              <CreateExpenseDialog />
            </CardHeader>
            <CardContent className="space-y-2">
              {(expensesQuery.data?.items ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No expenses yet.</p>
              ) : (
                (expensesQuery.data?.items ?? []).map((expense) => (
                  <Link
                    key={expense.id}
                    href={`/finance/expenses/${expense.id}`}
                    className="flex items-center justify-between rounded-md border p-3 text-sm hover:bg-muted/50"
                  >
                    <div>
                      <p className="font-medium">
                        {expense.category} — {expense.description}
                      </p>
                      <p className="text-muted-foreground">
                        {expense.amountPaid.toLocaleString()} / {expense.amount.toLocaleString()} paid
                      </p>
                    </div>
                    <Badge variant={EXPENSE_STATUS_VARIANT[expense.status]}>{expense.status}</Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="bank-accounts">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Bank Accounts</CardTitle>
              <CreateBankAccountDialog />
            </CardHeader>
            <CardContent className="space-y-2">
              {(bankAccountsQuery.data ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No bank accounts yet.</p>
              ) : (
                (bankAccountsQuery.data ?? []).map((account) => (
                  <div key={account.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div>
                      <p className="font-medium">{account.name}</p>
                      <p className="text-muted-foreground">
                        {account.bankName ?? "-"} {account.accountNumber ? `· ${account.accountNumber}` : ""}
                      </p>
                    </div>
                    <p className="font-semibold">{account.currentBalance.toLocaleString()}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
