"use client";

import { Card, CardContent, CardHeader, CardTitle, formatMoney, Skeleton } from "@bmp/ui";

import { useProjectCostingReport } from "@/hooks/use-reports";

function Line({ label, value, strong }: { label: string; value: number | null | undefined; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "border-t pt-2 font-semibold" : ""}`}>
      <span className={strong ? "" : "text-muted-foreground"}>{label}</span>
      <span className={(value ?? 0) < 0 ? "text-destructive" : ""}>{formatMoney(value)}</span>
    </div>
  );
}

export function ProjectProfitTab({ projectId }: { projectId: string }) {
  const reportQuery = useProjectCostingReport(projectId);
  const row = reportQuery.data?.projects[0];

  if (reportQuery.isLoading) return <Skeleton className="h-48 w-full" />;
  if (!row) return <p className="text-sm text-muted-foreground">No figures for this project.</p>;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Money in</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Line label="Client PO value" value={row.clientPoValue} />
          <Line label="Billed" value={row.billed} />
          <Line label="Received" value={row.received} strong />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Money out</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Line label="Vendor POs" value={row.vendorCost} />
          <Line label="Freight" value={row.freight} />
          <Line label="Other costs" value={row.otherCosts} />
          <Line label="Total cost" value={row.totalCost} strong />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Line label="Expected profit" value={row.expectedProfit} />
          <Line label="Profit so far" value={row.profit} strong />
          <p className="text-muted-foreground">
            {row.marginPercent === null ? "Nothing received yet." : `${row.marginPercent}% of what the client has paid.`}
          </p>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground md:col-span-3">
        Vendor POs count once issued. Freight comes from shipments; other costs are expenses tagged to this project.
        Record a freight bill as either shipment freight or an expense, not both.
      </p>
    </div>
  );
}
