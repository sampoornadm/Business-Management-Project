"use client";

import type { TenderDashboardStatsDto } from "@bmp/types";
import { Card, CardContent, formatMoney, Skeleton } from "@bmp/ui";
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { CHART_COLORS } from "@/lib/chart-colors";

const CHART_HEIGHT = 280;
const axisTick = { fontSize: 12, fill: "hsl(var(--muted-foreground))", fontFamily: "var(--font-mono)" } as const;

/** "2026-11" -> "Nov" (or "Nov 2026" with the year). Built in UTC so the month never shifts a day. */
function monthLabel(key: string, withYear = false): string {
  const [year, month] = key.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "short",
    year: withYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

/**
 * The dashboard's lead card: money we have quoted that is still waiting for a result, next to a
 * mirrored won (up) / lost (down) count per month. Won carries the accent; lost stays neutral.
 */
export function BidOutlookCard({
  stats,
  isLoading,
}: {
  stats: TenderDashboardStatsDto | undefined;
  isLoading: boolean;
}) {
  if (isLoading || !stats) {
    return (
      <Card>
        <CardContent className="grid gap-8 p-6 lg:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="w-full lg:col-span-2" style={{ height: CHART_HEIGHT }} />
        </CardContent>
      </Card>
    );
  }

  const { bidsInPlay, outcomesByMonth } = stats;
  const recorded = bidsInPlay.count - bidsInPlay.unrecordedCount;
  const won = outcomesByMonth.reduce((sum, m) => sum + m.won, 0);
  const lost = outcomesByMonth.reduce((sum, m) => sum + m.lost, 0);
  const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;
  // Lost is drawn below the axis; stackOffset="sign" keeps the two series on opposite sides.
  const chartData = outcomesByMonth.map((m) => ({ month: m.month, won: m.won, lost: -m.lost }));
  const peak = Math.max(1, ...outcomesByMonth.flatMap((m) => [m.won, m.lost]));

  return (
    <Card>
      <CardContent className="grid gap-8 p-6 lg:grid-cols-3">
        <div className="flex flex-col justify-between gap-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Bid value in play</p>
            <p className="break-words font-mono text-3xl font-medium tabular-nums leading-none">
              {/* Nothing recorded is not the same as ₹0 quoted: show a dash, not a zero total. */}
              {bidsInPlay.count > 0 && recorded === 0 ? "-" : formatMoney(bidsInPlay.value)}
            </p>
            <p className="text-sm text-muted-foreground">
              {bidsInPlay.count === 0
                ? "No submitted tenders waiting for a result"
                : `${bidsInPlay.count} ${bidsInPlay.count === 1 ? "tender" : "tenders"} waiting for a result`}
            </p>
            {bidsInPlay.unrecordedCount > 0 && (
              <p className="text-xs text-muted-foreground">
                {recorded === 0
                  ? "None has a recorded submission yet, so there is no total"
                  : `Total covers ${recorded}; ${bidsInPlay.unrecordedCount} ${
                      bidsInPlay.unrecordedCount === 1 ? "has" : "have"
                    } no recorded submission`}
              </p>
            )}
          </div>

          <dl className="grid grid-cols-3 gap-4 border-t pt-4">
            <div>
              <dt className="text-xs text-muted-foreground">Won</dt>
              <dd className="font-mono text-lg font-medium tabular-nums">{won}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Lost</dt>
              <dd className="font-mono text-lg font-medium tabular-nums">{lost}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Win rate</dt>
              <dd className="font-mono text-lg font-medium tabular-nums">{winRate === null ? "-" : `${winRate}%`}</dd>
            </div>
          </dl>
        </div>

        <div className="min-w-0 lg:col-span-2">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium">Won and lost, last 12 months</p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: CHART_COLORS.primary }} aria-hidden />
                Won
              </span>
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-sm bg-muted-foreground/40" aria-hidden />
                Lost
              </span>
            </div>
          </div>
          {won + lost === 0 ? (
            <p
              className="flex items-center justify-center text-sm text-muted-foreground"
              style={{ height: CHART_HEIGHT }}
            >
              No tenders won or lost in the last 12 months
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={chartData} stackOffset="sign" margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={CHART_COLORS.border} />
                <XAxis
                  dataKey="month"
                  tick={axisTick}
                  tickFormatter={(key: string) => monthLabel(key)}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={axisTick}
                  width={32}
                  allowDecimals={false}
                  domain={[-peak, peak]}
                  tickFormatter={(value: number) => String(Math.abs(value))}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine y={0} stroke="hsl(var(--border))" />
                <Tooltip
                  cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                  labelFormatter={(key: string) => monthLabel(key, true)}
                  formatter={(value: number, name: string) => [Math.abs(value), name]}
                  separator=": "
                  // Item text in the popover colour: the lost series' 40%-opacity fill is unreadable as text.
                  itemStyle={{ color: "hsl(var(--popover-foreground))" }}
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    borderColor: "hsl(var(--border))",
                    color: "hsl(var(--popover-foreground))",
                    fontSize: 12,
                    borderRadius: 6,
                  }}
                />
                <Bar
                  dataKey="won"
                  name="Won"
                  stackId="outcome"
                  fill={CHART_COLORS.primary}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
                <Bar
                  dataKey="lost"
                  name="Lost"
                  stackId="outcome"
                  fill="hsl(var(--muted-foreground) / 0.4)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
