"use client";

import { TENDER_STATUS_LABELS, type TenderStatus } from "@bmp/types";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  KpiGrid,
  Skeleton,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@bmp/ui";
import { Clock, Download, Percent, Timer, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  downloadReportExport,
  useFinancialSummaryReport,
  useKpis,
  useProcurementSpendReport,
  useProjectCostingReport,
  useTenderPipelineReport,
  useVendorPerformanceReport,
} from "@/hooks/use-reports";
import { CHART_COLORS } from "@/lib/chart-colors";
import { tenderStatusChartColor } from "@/lib/tender-status";

const RECEIVED_COLOR = "#0072B2";
const PAID_COLOR = "#E69F00";

function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return value.toLocaleString();
}

function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${value.toFixed(1)} days`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${value.toFixed(1)}%`;
}

const compactNumberFormatter = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });
// Chart axes need short labels ("16L" not "1,600,000") or ticks overlap when the
// value range is narrow relative to the chart's height — full precision stays in
// the tooltip and the table below.
function formatCompactNumber(value: number): string {
  return compactNumberFormatter.format(value);
}

const chartTooltipStyle = {
  contentStyle: {
    backgroundColor: "hsl(var(--popover))",
    borderColor: "hsl(var(--border))",
    color: "hsl(var(--popover-foreground))",
    fontSize: 12,
    borderRadius: 6,
  },
} as const;

function ExportButtons({
  reportKey,
  range,
}: {
  reportKey: "tender-pipeline" | "procurement-spend" | "project-costing" | "financial-summary" | "vendor-performance";
  range?: { from?: string; to?: string };
}) {
  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => void downloadReportExport(reportKey, "xlsx", range)}>
        <Download className="mr-1.5 h-3.5 w-3.5" /> Excel
      </Button>
      <Button variant="outline" size="sm" onClick={() => void downloadReportExport(reportKey, "pdf", range)}>
        <Download className="mr-1.5 h-3.5 w-3.5" /> PDF
      </Button>
    </div>
  );
}

function DateRangeFilter({
  from,
  to,
  onFromChange,
  onToChange,
}: {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-sm text-muted-foreground">From</label>
      <Input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} className="w-40" />
      <label className="text-sm text-muted-foreground">To</label>
      <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} className="w-40" />
    </div>
  );
}

function KpiCards() {
  const kpisQuery = useKpis();
  const kpis = kpisQuery.data;

  return (
    <KpiGrid className="md:grid-cols-4 lg:grid-cols-4">
      <StatCard
        label="Win rate"
        icon={Percent}
        isLoading={kpisQuery.isLoading}
        value={formatPercent(kpis?.winRate)}
      />
      <StatCard
        label="Avg BOQ turnaround"
        icon={Clock}
        isLoading={kpisQuery.isLoading}
        value={formatDays(kpis?.avgBoqTurnaroundDays)}
      />
      <StatCard
        label="Avg goods receipt lead time"
        icon={Timer}
        isLoading={kpisQuery.isLoading}
        value={formatDays(kpis?.avgGoodsReceiptLeadDays)}
      />
      <StatCard
        label="Receivables DSO"
        icon={Wallet}
        isLoading={kpisQuery.isLoading}
        value={formatDays(kpis?.receivablesDsoDays)}
      />
    </KpiGrid>
  );
}

function TenderPipelineTab() {
  const router = useRouter();
  const reportQuery = useTenderPipelineReport();
  const report = reportQuery.data;
  const chartData = (report?.byStatus ?? []).map((row) => ({
    status: row.status as TenderStatus,
    label: TENDER_STATUS_LABELS[row.status as TenderStatus] ?? row.status,
    count: row.count,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Total tenders</p>
            <p className="text-lg font-semibold">{formatNumber(report?.totalTenders)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Won / Lost</p>
            <p className="text-lg font-semibold">
              {formatNumber(report?.wonCount)} / {formatNumber(report?.lostCount)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Avg submission time</p>
            <p className="text-lg font-semibold">{formatDays(report?.avgSubmissionDays)}</p>
          </div>
        </div>
        <ExportButtons reportKey="tender-pipeline" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Tenders by status</CardTitle>
        </CardHeader>
        <CardContent>
          {reportQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tenders yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  angle={-30}
                  textAnchor="end"
                  height={80}
                  interval={0}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={28} />
                <Tooltip cursor={{ fill: "hsl(var(--muted))" }} {...chartTooltipStyle} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.status}
                      fill={tenderStatusChartColor(entry.status)}
                      cursor="pointer"
                      onClick={() => router.push(`/tenders?status=${entry.status}`)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ProcurementSpendTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = { from: from || undefined, to: to || undefined };
  const reportQuery = useProcurementSpendReport(range);
  const report = reportQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <ExportButtons reportKey="procurement-spend" range={range} />
      </div>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Grand total spend</p>
          <p className="text-2xl font-semibold">{formatNumber(report?.grandTotal)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Spend by month</CardTitle>
        </CardHeader>
        <CardContent>
          {reportQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (report?.byMonth.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No purchase order spend in range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={report?.byMonth} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  width={48}
                  tickFormatter={formatCompactNumber}
                />
                <Tooltip
                  cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1 }}
                  formatter={(value: number) => value.toLocaleString()}
                  {...chartTooltipStyle}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  fill="url(#spendFill)"
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Spend by vendor</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Total spend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(report?.byVendor.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={2} className="text-center text-sm text-muted-foreground">
                    No purchase order spend in range.
                  </TableCell>
                </TableRow>
              ) : (
                report?.byVendor.map((row) => (
                  <TableRow key={row.vendorId}>
                    <TableCell>{row.vendorName}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.total)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ProjectCostingTab() {
  const reportQuery = useProjectCostingReport();
  const report = reportQuery.data;
  const chartData = report?.projects ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">Total budget</p>
            <p className="text-lg font-semibold">{formatNumber(report?.totalBudget)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Total actual cost</p>
            <p className="text-lg font-semibold">{formatNumber(report?.totalActualCost)}</p>
          </div>
        </div>
        <ExportButtons reportKey="project-costing" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Budget vs. actual by project</CardTitle>
        </CardHeader>
        <CardContent>
          {reportQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active projects.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 48)}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 16, bottom: 4 }}
                barGap={4}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={formatCompactNumber}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  width={160}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  formatter={(value: number) => value.toLocaleString()}
                  {...chartTooltipStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="budget" name="Budget" fill={CHART_COLORS.muted} radius={[0, 4, 4, 0]} maxBarSize={16} />
                <Bar dataKey="actualCost" name="Actual cost" radius={[0, 4, 4, 0]} maxBarSize={16}>
                  {chartData.map((row) => (
                    <Cell
                      key={row.projectId}
                      fill={row.variance < 0 ? CHART_COLORS.destructive : CHART_COLORS.success}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Actual cost</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ) : (report?.projects.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No active projects.
                  </TableCell>
                </TableRow>
              ) : (
                report?.projects.map((row) => (
                  <TableRow key={row.projectId}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{formatNumber(row.budget)}</TableCell>
                    <TableCell className="text-right">{formatNumber(row.actualCost)}</TableCell>
                    <TableCell className={`text-right ${row.variance < 0 ? "text-destructive" : ""}`}>
                      {formatNumber(row.variance)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FinancialSummaryTab() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = { from: from || undefined, to: to || undefined };
  const reportQuery = useFinancialSummaryReport(range);
  const report = reportQuery.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        <ExportButtons reportKey="financial-summary" range={range} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Received vs. paid by month</CardTitle>
        </CardHeader>
        <CardContent>
          {reportQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (report?.months.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No payments in range.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={report?.months} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  width={48}
                  tickFormatter={formatCompactNumber}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  formatter={(value: number) => value.toLocaleString()}
                  {...chartTooltipStyle}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar
                  dataKey="received"
                  name="Received"
                  fill={RECEIVED_COLOR}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                  activeBar={{ fillOpacity: 0.75 }}
                />
                <Bar
                  dataKey="paid"
                  name="Paid"
                  fill={PAID_COLOR}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={32}
                  activeBar={{ fillOpacity: 0.75 }}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function VendorPerformanceTab() {
  const reportQuery = useVendorPerformanceReport();
  const report = reportQuery.data;
  const chartData = (report?.vendors ?? [])
    .filter((v) => v.onTimeDeliveryRate !== null)
    .slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButtons reportKey="vendor-performance" />
      </div>
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">On-time delivery by vendor</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(120, chartData.length * 40)}>
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 4, right: 24, left: 16, bottom: 4 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis
                  type="category"
                  dataKey="vendorName"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  width={160}
                />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  formatter={(value: number) => `${value.toFixed(1)}%`}
                  {...chartTooltipStyle}
                />
                <Bar dataKey="onTimeDeliveryRate" name="On-time delivery" radius={[0, 4, 4, 0]} maxBarSize={20}>
                  {chartData.map((row) => (
                    <Cell
                      key={row.vendorId}
                      fill={
                        (row.onTimeDeliveryRate ?? 0) >= 90
                          ? CHART_COLORS.success
                          : (row.onTimeDeliveryRate ?? 0) < 70
                            ? CHART_COLORS.destructive
                            : CHART_COLORS.primary
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Avg rating</TableHead>
                <TableHead className="text-right">Total ratings</TableHead>
                <TableHead className="text-right">On-time delivery</TableHead>
                <TableHead className="text-right">Total POs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reportQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ) : (report?.vendors.length ?? 0) === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                    No vendors with purchase order activity.
                  </TableCell>
                </TableRow>
              ) : (
                report?.vendors.map((row) => (
                  <TableRow key={row.vendorId}>
                    <TableCell>{row.vendorName}</TableCell>
                    <TableCell className="text-right">{row.averageRating?.toFixed(1) ?? "-"}</TableCell>
                    <TableCell className="text-right">{row.totalRatings}</TableCell>
                    <TableCell className="text-right">{formatPercent(row.onTimeDeliveryRate)}</TableCell>
                    <TableCell className="text-right">{row.totalPurchaseOrders}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">
          Cross-module insights across tenders, procurement, projects, and finance.
        </p>
      </div>

      <KpiCards />

      <Tabs defaultValue="tender-pipeline">
        <TabsList>
          <TabsTrigger value="tender-pipeline">Tender Pipeline</TabsTrigger>
          <TabsTrigger value="procurement-spend">Procurement Spend</TabsTrigger>
          <TabsTrigger value="project-costing">Project Costing</TabsTrigger>
          <TabsTrigger value="financial-summary">Financial Summary</TabsTrigger>
          <TabsTrigger value="vendor-performance">Vendor Performance</TabsTrigger>
        </TabsList>
        <TabsContent value="tender-pipeline">
          <TenderPipelineTab />
        </TabsContent>
        <TabsContent value="procurement-spend">
          <ProcurementSpendTab />
        </TabsContent>
        <TabsContent value="project-costing">
          <ProjectCostingTab />
        </TabsContent>
        <TabsContent value="financial-summary">
          <FinancialSummaryTab />
        </TabsContent>
        <TabsContent value="vendor-performance">
          <VendorPerformanceTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
