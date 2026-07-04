"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Skeleton,
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
import { Download } from "lucide-react";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Win rate</p>
          {kpisQuery.isLoading ? (
            <Skeleton className="mt-1 h-8 w-16" />
          ) : (
            <p className="text-2xl font-semibold">{formatPercent(kpis?.winRate)}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Avg BOQ turnaround</p>
          {kpisQuery.isLoading ? (
            <Skeleton className="mt-1 h-8 w-16" />
          ) : (
            <p className="text-2xl font-semibold">{formatDays(kpis?.avgBoqTurnaroundDays)}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Avg goods receipt lead time</p>
          {kpisQuery.isLoading ? (
            <Skeleton className="mt-1 h-8 w-16" />
          ) : (
            <p className="text-2xl font-semibold">{formatDays(kpis?.avgGoodsReceiptLeadDays)}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Receivables DSO</p>
          {kpisQuery.isLoading ? (
            <Skeleton className="mt-1 h-8 w-16" />
          ) : (
            <p className="text-2xl font-semibold">{formatDays(kpis?.receivablesDsoDays)}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TenderPipelineTab() {
  const reportQuery = useTenderPipelineReport();
  const report = reportQuery.data;
  const chartData = (report?.byStatus ?? []).map((row) => ({ status: row.status, count: row.count }));

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
                  dataKey="status"
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  angle={-30}
                  textAnchor="end"
                  height={80}
                  interval={0}
                />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={28} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--popover-foreground))",
                    fontSize: 12,
                    borderRadius: 6,
                  }}
                />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} />
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
              <BarChart data={report?.byMonth} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={48} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--popover-foreground))",
                    fontSize: 12,
                    borderRadius: 6,
                  }}
                />
                <Bar dataKey="total" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
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
                <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={48} />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))" }}
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--popover-foreground))",
                    fontSize: 12,
                    borderRadius: 6,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="received" name="Received" fill={RECEIVED_COLOR} radius={[4, 4, 0, 0]} maxBarSize={32} />
                <Bar dataKey="paid" name="Paid" fill={PAID_COLOR} radius={[4, 4, 0, 0]} maxBarSize={32} />
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

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <ExportButtons reportKey="vendor-performance" />
      </div>
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
    <div className="max-w-6xl space-y-6">
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
