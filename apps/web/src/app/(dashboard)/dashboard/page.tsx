"use client";

import { TENDER_STATUS_LABELS, type TenderStatus } from "@bmp/types";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  formatDate,
  KpiGrid,
  PageHeader,
  Skeleton,
  StatCard,
} from "@bmp/ui";
import Link from "next/link";

import { humanize } from "@/components/status-badge";
import { BidOutlookCard } from "@/components/tenders/bid-outlook-card";
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

function HealthDot({ ok, label }: { ok: boolean | undefined; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          ok === undefined ? "bg-muted-foreground/40" : ok ? "bg-success" : "bg-destructive"
        }`}
        aria-hidden="true"
      />
      {label}
      <span className="sr-only">{ok === undefined ? "checking" : ok ? "up" : "down"}</span>
    </span>
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

  // Pipeline order (Draft first), not the arbitrary order the counts arrive in.
  const byStatus = tenderStatsQuery.data?.byStatus ?? {};
  const statusRows = (Object.keys(TENDER_STATUS_LABELS) as TenderStatus[])
    .filter((status) => (byStatus[status] ?? 0) > 0)
    .map((status) => ({ status, label: TENDER_STATUS_LABELS[status], count: byStatus[status] ?? 0 }));
  const statusPeak = Math.max(1, ...statusRows.map((row) => row.count));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={user?.role.name ? `Signed in as ${humanize(user.role.name)}` : undefined}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <HealthDot ok={healthQuery.data?.postgres} label="Database" />
          <HealthDot ok={healthQuery.data?.redis} label="Cache" />
          <HealthDot ok={healthQuery.data?.s3} label="File storage" />
        </div>
      </PageHeader>

      <KpiGrid>
        <StatCard label="Users" isLoading={usersQuery.isLoading} value={usersQuery.data?.totalItems ?? 0} />

        {canReadTenders && (
          <StatCard
            label="Active tenders"
            isLoading={tenderStatsQuery.isLoading}
            value={tenderStatsQuery.data?.totalActive ?? 0}
          />
        )}

        {canReadTenders && (
          <StatCard
            label="Due in the next 7 days"
            isLoading={tenderStatsQuery.isLoading}
            value={tenderStatsQuery.data?.upcomingDeadlines.length ?? 0}
          />
        )}
      </KpiGrid>

      {canReadTenders && <BidOutlookCard stats={tenderStatsQuery.data} isLoading={tenderStatsQuery.isLoading} />}

      {canReadTenders && (
        <div className="grid gap-4 lg:grid-cols-5">
          <Card className="min-w-0 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Tenders by status</CardTitle>
            </CardHeader>
            <CardContent>
              {tenderStatsQuery.isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : statusRows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tenders yet.</p>
              ) : (
                <ul className="space-y-1">
                  {statusRows.map((row) => (
                    <li key={row.status}>
                      <Link
                        href={`/tenders?status=${row.status}`}
                        className="block rounded-md px-2 py-2 transition-colors hover:bg-accent"
                      >
                        <span className="flex items-baseline justify-between gap-2 text-sm">
                          <span>{row.label}</span>
                          <span className="font-mono tabular-nums text-muted-foreground">{row.count}</span>
                        </span>
                        <span className="mt-2 block h-1 rounded-full bg-muted">
                          <span
                            className="block h-full rounded-full bg-muted-foreground/40"
                            style={{ width: `${(row.count / statusPeak) * 100}%` }}
                          />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-sm font-medium">Upcoming deadlines</CardTitle>
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
                  {tenderStatsQuery.data?.upcomingDeadlines.map((tender) => {
                    // The query filters on a submissionDate range, so these always have one;
                    // the guard is only here because the field is nullable app-wide.
                    const daysLeft = tender.submissionDate
                      ? Math.ceil((new Date(tender.submissionDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                      : null;
                    const dueSoon = daysLeft !== null && daysLeft <= 2;
                    return (
                      <li key={tender.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <Link href={`/tenders/${tender.id}`} className="min-w-0 flex-1 hover:underline">
                          <span className="block truncate font-medium">{tender.title}</span>
                          <span className="font-mono text-xs text-muted-foreground">{tender.tenderNumber}</span>
                        </Link>
                        <div className="flex shrink-0 items-center gap-2">
                          {dueSoon && <Badge variant="signal">Due soon</Badge>}
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatDate(tender.submissionDate)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {canReadAudit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Recent activity</CardTitle>
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
                      <span className="text-muted-foreground">{log.action.replaceAll("_", " ").toLowerCase()}</span>
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
