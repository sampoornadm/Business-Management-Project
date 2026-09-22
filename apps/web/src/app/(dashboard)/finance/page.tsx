"use client";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  KpiGrid,
  StatCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@bmp/ui";
import { CreditCard, HandCoins, Landmark, Wallet } from "lucide-react";
import Link from "next/link";

import { CreateBankAccountDialog } from "@/components/finance/create-bank-account-dialog";
import { CreateExpenseDialog } from "@/components/finance/create-expense-dialog";
import { CreateInvoiceDialog } from "@/components/finance/create-invoice-dialog";
import { FinanceCharts } from "@/components/finance/finance-charts";
import { useBankAccounts, useExpenses, useFinanceSummary, useInvoices } from "@/hooks/use-finance";

const INVOICE_STATUS_VARIANT: Record<string, "success" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  SENT: "secondary",
  PARTIALLY_PAID: "secondary",
  PAID: "success",
  OVERDUE: "destructive",
};

const EXPENSE_STATUS_VARIANT: Record<string, "success" | "secondary" | "outline" | "destructive"> = {
  UNPAID: "outline",
  PARTIALLY_PAID: "secondary",
  PAID: "success",
};

export default function FinancePage() {
  const summaryQuery = useFinanceSummary();
  const invoicesQuery = useInvoices({ page: 1, pageSize: 20 });
  const expensesQuery = useExpenses({ page: 1, pageSize: 20 });
  const bankAccountsQuery = useBankAccounts();
  const summary = summaryQuery.data;
  const bankTotal = (summary?.bankBalances ?? []).reduce((sum, b) => sum + b.balance, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-sm text-muted-foreground">
          Invoices, expenses, payments, and cash/bank balances.
        </p>
      </div>

      {/* 2 columns from lg, 4 from xl: with the sidebar open, 4 columns any earlier leave each card too
          narrow for a 7-figure amount. StatCard also wraps an over-long value inside itself. */}
      <KpiGrid className="lg:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Receivables"
          icon={HandCoins}
          isLoading={summaryQuery.isLoading}
          value={summary ? summary.totalReceivables.toLocaleString() : "-"}
          hint="Invoiced, not yet received"
        />
        <StatCard
          label="Payables"
          icon={CreditCard}
          isLoading={summaryQuery.isLoading}
          value={summary ? summary.totalPayables.toLocaleString() : "-"}
          hint="Unpaid expenses and POs"
        />
        <StatCard
          label="Cash balance"
          icon={Wallet}
          isLoading={summaryQuery.isLoading}
          value={summary ? summary.cashBalance.toLocaleString() : "-"}
          hint="Cash received minus cash paid"
        />
        <StatCard
          label="Bank balances"
          icon={Landmark}
          isLoading={summaryQuery.isLoading}
          value={summary ? bankTotal.toLocaleString() : "-"}
          hint={summary ? `${summary.bankBalances.length} account${summary.bankBalances.length === 1 ? "" : "s"}` : undefined}
        />
      </KpiGrid>

      <FinanceCharts />

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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(invoicesQuery.data?.items ?? []).map((invoice) => (
                    <Link
                      key={invoice.id}
                      href={`/finance/invoices/${invoice.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={`${invoice.invoiceNumber} — ${invoice.clientName}`}>
                          {invoice.invoiceNumber} — {invoice.clientName}
                        </p>
                        <p className="break-words text-muted-foreground">
                          {invoice.amountPaid.toLocaleString()} / {invoice.totalAmount.toLocaleString()} paid
                        </p>
                      </div>
                      <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]} className="shrink-0">
                        {invoice.status}
                      </Badge>
                    </Link>
                  ))}
                </div>
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(expensesQuery.data?.items ?? []).map((expense) => (
                    <Link
                      key={expense.id}
                      href={`/finance/expenses/${expense.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm hover:bg-muted/50"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={`${expense.category} — ${expense.description}`}>
                          {expense.category} — {expense.description}
                        </p>
                        <p className="break-words text-muted-foreground">
                          {expense.amountPaid.toLocaleString()} / {expense.amount.toLocaleString()} paid
                        </p>
                      </div>
                      <Badge variant={EXPENSE_STATUS_VARIANT[expense.status]} className="shrink-0">
                        {expense.status}
                      </Badge>
                    </Link>
                  ))}
                </div>
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
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {(bankAccountsQuery.data ?? []).map((account) => (
                    <div
                      key={account.id}
                      className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={account.name}>
                          {account.name}
                        </p>
                        <p className="truncate text-muted-foreground">
                          {account.bankName ?? "-"} {account.accountNumber ? `· ${account.accountNumber}` : ""}
                        </p>
                      </div>
                      <p className="max-w-[55%] break-words text-right font-semibold tabular-nums">
                        {account.currentBalance.toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
