"use client";

import { TENDER_STATUS_LABELS, type TenderStatus } from "@bmp/types";
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from "@bmp/ui";
import { Activity, Database, FileClock, FileText, HardDrive, Users2 } from "lucide-react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useAuditLogs } from "@/hooks/use-audit-logs";
import { useHealth } from "@/hooks/use-health";
import { useTenderDashboardStats } from "@/hooks/use-tender-dashboard-stats";
import { useUsers } from "@/hooks/use-users";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function HealthDot({ ok }: { ok: boolean | undefined }) {
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${
        ok === undefined ? "bg-muted-foreground/40" : ok ? "bg-green-500" : "bg-destructive"
      }`}
    />
  );
}

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user);
  const canReadAudit = hasPermission(user?.role.name, "audit:read");
  const canReadTenders = hasPermission(user?.role.name, "tenders:read");
  const usersQuery = useUsers({ page: 1, pageSize: 1 });
  const auditQuery = useAuditLogs({ page: 1, pageSize: 5 }, canReadAudit);
  const healthQuery = useHealth();
  const tenderStatsQuery = useTenderDashboardStats();

  const statusChartData = Object.entries(tenderStatsQuery.data?.byStatus ?? {}).map(([status, count]) => ({
    status: TENDER_STATUS_LABELS[status as TenderStatus],
    count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back, {user?.firstName}</h1>
        <p className="text-sm text-muted-foreground">Here&apos;s what&apos;s happening in your workspace.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {usersQuery.isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">{usersQuery.data?.totalItems ?? 0}</div>
            )}
          </CardContent>
        </Card>

        {canReadTenders && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Tenders</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {tenderStatsQuery.isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <div className="text-2xl font-bold">{tenderStatsQuery.data?.totalActive ?? 0}</div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Your Role</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">{user?.role.name}</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex items-center gap-2">
              <HealthDot ok={healthQuery.data?.postgres} /> Database
            </div>
            <div className="flex items-center gap-2">
              <HealthDot ok={healthQuery.data?.redis} /> Cache
            </div>
            <div className="flex items-center gap-2">
              <HealthDot ok={healthQuery.data?.s3} /> File storage
            </div>
          </CardContent>
        </Card>
      </div>

      {canReadTenders && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Tenders by Status</CardTitle>
            </CardHeader>
            <CardContent>
              {tenderStatsQuery.isLoading ? (
                <Skeleton className="h-64 w-full" />
              ) : statusChartData.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tenders yet.</p>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={statusChartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="status"
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      angle={-30}
                      textAnchor="end"
                      height={70}
                      interval={0}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                      width={28}
                    />
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

          <Card>
            <CardHeader className="flex flex-row items-center gap-2">
              <FileClock className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Upcoming Deadlines (7 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {tenderStatsQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : (tenderStatsQuery.data?.upcomingDeadlines.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No submissions due in the next 7 days.</p>
              ) : (
                <ul className="divide-y">
                  {tenderStatsQuery.data?.upcomingDeadlines.map((tender) => (
                    <li key={tender.id} className="flex items-center justify-between py-2 text-sm">
                      <Link href={`/tenders/${tender.id}`} className="min-w-0 flex-1 hover:underline">
                        <span className="block truncate font-medium">{tender.title}</span>
                        <span className="text-xs text-muted-foreground">{tender.tenderNumber}</span>
                      </Link>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {new Date(tender.submissionDate).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {canReadAudit && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {auditQuery.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : auditQuery.data && auditQuery.data.items.length > 0 ? (
              <ul className="divide-y">
                {auditQuery.data.items.map((log) => (
                  <li key={log.id} className="flex items-center justify-between py-2 text-sm">
                    <span>
                      <span className="font-medium">
                        {log.actor ? `${log.actor.firstName} ${log.actor.lastName}` : "System"}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {log.action.replaceAll("_", " ").toLowerCase()}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{timeAgo(log.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No recent activity yet.</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
