"use client";

import { Card, CardContent, CardHeader, CardTitle, cn, Skeleton } from "@bmp/ui";
import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useCashBook, useExpenses, useFinanceSummary, useInvoices } from "@/hooks/use-finance";
import { CHART_COLORS } from "@/lib/chart-colors";
import {
  buildCashFlowMonths,
  formatCompact,
  sumExpensesByCategory,
  sumInvoicesByStatus,
} from "@/lib/finance-charts";

const axisTick = { fontSize: 11, fill: "hsl(var(--muted-foreground))" } as const;
const tooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(var(--popover))",
    borderColor: "hsl(var(--border))",
    color: "hsl(var(--popover-foreground))",
    fontSize: 12,
    borderRadius: 6,
  },
} as const;
const CHART_HEIGHT = 260;
const money = (value: number): string => value.toLocaleString();
const truncateLabel = (value: string): string => (value.length > 16 ? `${value.slice(0, 15)}…` : value);

function ChartCard({
  title,
  caption,
  className,
  loading,
  empty,
  emptyText,
  children,
}: {
  title: string;
  caption?: string | null;
  className?: string;
  loading: boolean;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  return (
    // min-w-0: a ResponsiveContainer inside a grid track otherwise refuses to shrink with the window.
    <Card className={cn("min-w-0", className)}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />
        ) : empty ? (
          <p className="flex items-center justify-center text-sm text-muted-foreground" style={{ height: CHART_HEIGHT }}>
            {emptyText}
          </p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

const sampleCaption = (label: string, shown: number, total: number): string | null =>
  total > shown ? `Based on the latest ${shown} of ${total} ${label}` : null;

/** Overview charts for the Finance page. Each card owns its own loading and empty state. */
export function FinanceCharts() {
  const summaryQuery = useFinanceSummary();
  const cashBookQuery = useCashBook();
  // Aggregates are computed client-side from the latest 100 rows (the API's page-size cap); the
  // card captions say so when there are more, rather than presenting a sample as the total.
  const invoicesQuery = useInvoices({ page: 1, pageSize: 100 });
  const expensesQuery = useExpenses({ page: 1, pageSize: 100 });

  const months = buildCashFlowMonths(cashBookQuery.data ?? [], new Date());
  const banks = summaryQuery.data?.bankBalances ?? [];
  const invoiceSlices = sumInvoicesByStatus(invoicesQuery.data?.items ?? []);
  const invoiceTotal = invoiceSlices.reduce((sum, s) => sum + s.amount, 0);
  const expenseBars = sumExpensesByCategory(expensesQuery.data?.items ?? []).slice(0, 6);

  return (
    <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
      <ChartCard
        className="lg:col-span-2"
        title="Cash flow"
        caption="Money received vs paid out, last 6 months"
        loading={cashBookQuery.isLoading}
        empty={months.every((m) => m.received === 0 && m.paid === 0)}
        emptyText="No payments recorded in the last 6 months."
      >
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <ComposedChart data={months} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.border} />
            <XAxis dataKey="label" tick={axisTick} />
            <YAxis tick={axisTick} width={48} tickFormatter={formatCompact} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
              formatter={(value: number, name: string) => [money(value), name]}
              {...tooltipStyle}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="received" name="Received" fill={CHART_COLORS.success} radius={[3, 3, 0, 0]} maxBarSize={28} />
            <Bar dataKey="paid" name="Paid out" fill={CHART_COLORS.destructive} radius={[3, 3, 0, 0]} maxBarSize={28} />
            {/* foreground, not primary/signal: some business themes are amber, which would make the net
                line indistinguishable from the bars */}
            <Line
              dataKey="net"
              name="Net"
              type="monotone"
              stroke="hsl(var(--foreground))"
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={{ r: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Bank balances"
        caption="Current balance per account"
        loading={summaryQuery.isLoading}
        empty={banks.length === 0}
        emptyText="No bank accounts yet."
      >
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={banks} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_COLORS.border} />
            <XAxis type="number" tick={axisTick} tickFormatter={formatCompact} />
            <YAxis type="category" dataKey="name" tick={axisTick} width={112} tickFormatter={truncateLabel} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
              formatter={(value: number) => [money(value), "Balance"]}
              {...tooltipStyle}
            />
            <Bar dataKey="balance" radius={[0, 3, 3, 0]} maxBarSize={28}>
              {banks.map((bank) => (
                <Cell
                  key={bank.bankAccountId}
                  fill={bank.balance < 0 ? CHART_COLORS.destructive : CHART_COLORS.primary}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard
        title="Invoices by status"
        caption={sampleCaption("invoices", invoicesQuery.data?.items.length ?? 0, invoicesQuery.data?.totalItems ?? 0) ?? "Invoice value"}
        loading={invoicesQuery.isLoading}
        empty={invoiceSlices.length === 0}
        emptyText="No invoices yet."
      >
        <div className="flex flex-col gap-3" style={{ minHeight: CHART_HEIGHT }}>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie
                data={invoiceSlices}
                dataKey="amount"
                nameKey="label"
                innerRadius={44}
                outerRadius={70}
                paddingAngle={2}
                stroke="none"
              >
                {invoiceSlices.map((slice) => (
                  <Cell key={slice.status} fill={slice.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number, name: string) => [money(value), name]} {...tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="space-y-1 text-xs">
            {invoiceSlices.map((slice) => (
              <li key={slice.status} className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
                <span className="min-w-0 flex-1 truncate">
                  {slice.label} <span className="text-muted-foreground">({slice.count})</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {invoiceTotal > 0 ? `${Math.round((slice.amount / invoiceTotal) * 100)}%` : "-"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </ChartCard>

      <ChartCard
        className="lg:col-span-2"
        title="Expenses by category"
        caption={sampleCaption("expenses", expensesQuery.data?.items.length ?? 0, expensesQuery.data?.totalItems ?? 0) ?? "Paid vs still owed"}
        loading={expensesQuery.isLoading}
        empty={expenseBars.length === 0}
        emptyText="No expenses yet."
      >
        <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
          <BarChart data={expenseBars} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={CHART_COLORS.border} />
            <XAxis type="number" tick={axisTick} tickFormatter={formatCompact} />
            <YAxis type="category" dataKey="label" tick={axisTick} width={80} />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
              formatter={(value: number, name: string) => [money(value), name]}
              {...tooltipStyle}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="paid" name="Paid" stackId="expense" fill={CHART_COLORS.success} maxBarSize={28} />
            <Bar
              dataKey="outstanding"
              name="Still owed"
              stackId="expense"
              fill="hsl(var(--signal))"
              radius={[0, 3, 3, 0]}
              maxBarSize={28}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
