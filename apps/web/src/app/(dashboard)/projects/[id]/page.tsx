"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DeadlineProgress,
  formatDate,
  formatMoney,
  KpiGrid,
  PageHeader,
  PageSkeleton,
  StatCard,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@bmp/ui";
import Link from "next/link";
import { useParams } from "next/navigation";

import { ClientPurchaseOrdersTab } from "@/components/projects/client-purchase-orders-tab";
import { ProjectOverviewTab } from "@/components/projects/project-overview-tab";
import { ProjectProfitTab } from "@/components/projects/project-profit-tab";
import { SupplyTab } from "@/components/projects/supply-tab";
import { StatusBadge } from "@/components/status-badge";
import { useProjectClientPurchaseOrders } from "@/hooks/use-client-purchase-orders";
import { useProject, useProjectOverview } from "@/hooks/use-projects";
import { useProjectSupply } from "@/hooks/use-shipments";
import { useAuthStore } from "@/lib/auth-store";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";
import { daysUntil, isPastDue } from "@/lib/deadline";
import { hasPermission } from "@/lib/permissions";

// The construction-style Milestones/Material/Labor/progress-Bills tabs are hidden here (their
// components and data are kept): a supply order is driven by the client PO instead.

function overdueLabel(dueDate: string): string {
  const days = daysUntil(dueDate);
  if (days > 1) return `${days} days left`;
  if (days === 1) return "Due tomorrow";
  if (days === 0) return "Due today";
  return `${-days} day${days === -1 ? "" : "s"} overdue`;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const projectQuery = useProject(params.id);
  useBreadcrumbLabel(params.id, projectQuery.data?.name);
  const overviewQuery = useProjectOverview(params.id);
  const clientPosQuery = useProjectClientPurchaseOrders(params.id);
  const supplyQuery = useProjectSupply(params.id);

  if (projectQuery.isLoading || !projectQuery.data) {
    return <PageSkeleton />;
  }

  const project = projectQuery.data;
  const overview = overviewQuery.data;
  const clientPos = clientPosQuery.data;
  const dueDate = clientPos?.earliestDueDate ?? null;
  const clientValue = clientPos?.totalValue ?? 0;
  const procured = overview?.procurement.orderedValue ?? 0;
  const received = overview?.procurement.receivedValue ?? 0;
  const linesToCheck = (clientPos?.orders ?? []).flatMap((order) => order.items).filter((item) => item.flags.length > 0).length;
  const receivedPercent = percent(received, procured);

  return (
    <div className="space-y-6">
      <PageHeader title={project.name} badges={<StatusBadge status={project.status} />}>
        <p className="text-sm text-muted-foreground">
          {overview?.tender.clientName ? `${overview.tender.clientName} · ` : ""}Started {formatDate(project.startDate)}
          {" · "}
          <Link href={`/tenders/${project.tenderId}`} className="hover:underline">
            View source tender
          </Link>
        </p>
        {dueDate && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Delivery due</span>
            <DeadlineProgress
              className="flex items-center gap-2 space-y-0"
              dateText={formatDate(dueDate)}
              daysLeft={daysUntil(dueDate)}
              label={overdueLabel(dueDate)}
              pastDue={isPastDue(dueDate)}
            />
          </div>
        )}
      </PageHeader>

      <KpiGrid className="lg:grid-cols-4">
        <StatCard
          label="Client PO value"
          value={clientPos?.orders.length ? formatMoney(clientValue) : "No PO yet"}
          isLoading={clientPosQuery.isLoading}
          hint={
            clientPos?.orders.length
              ? `${clientPos.orders.length} PO${clientPos.orders.length === 1 ? "" : "s"}${linesToCheck ? ` · ${linesToCheck} line${linesToCheck === 1 ? "" : "s"} to check` : ""}`
              : "Record the client's PO to start"
          }
        />
        <StatCard
          label="Ordered from vendors"
          value={formatMoney(procured)}
          isLoading={overviewQuery.isLoading}
          hint={`${overview?.vendorPurchaseOrders.length ?? 0} vendor PO${overview?.vendorPurchaseOrders.length === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Received from vendors"
          value={`${receivedPercent}%`}
          isLoading={overviewQuery.isLoading}
          hint={
            <span className="block space-y-1">
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <span className="block h-full bg-success" style={{ width: `${receivedPercent}%` }} />
              </span>
              <span className="block">{formatMoney(received)} received</span>
            </span>
          }
        />
        <StatCard
          label="Planned margin"
          value={clientPos?.orders.length ? formatMoney(clientValue - procured) : "–"}
          isLoading={clientPosQuery.isLoading || overviewQuery.isLoading}
          hint="Client PO value minus vendor POs, before freight and other costs"
        />
      </KpiGrid>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="client-po">Client POs</TabsTrigger>
          <TabsTrigger value="supply">Supply</TabsTrigger>
          <TabsTrigger value="profit">Profit</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          {overview ? <ProjectOverviewTab overview={overview} /> : <PageSkeleton />}
        </TabsContent>
        <TabsContent value="client-po">
          <ClientPurchaseOrdersTab
            projectId={project.id}
            tenderId={project.tenderId}
            deliveryPeriodDays={overview?.tender.deliveryPeriodDays ?? 120}
            data={clientPos}
            canCreate={hasPermission(roleName, "client_purchase_orders:create")}
            canUpdate={hasPermission(roleName, "client_purchase_orders:update")}
            canDelete={hasPermission(roleName, "client_purchase_orders:delete")}
          />
        </TabsContent>
        <TabsContent value="supply">
          <SupplyTab
            projectId={project.id}
            supply={supplyQuery.data}
            orders={clientPos?.orders ?? []}
            permissions={{
              canCreate: hasPermission(roleName, "shipments:create"),
              canUpdate: hasPermission(roleName, "shipments:update"),
              canDelete: hasPermission(roleName, "shipments:delete"),
              canBill: hasPermission(roleName, "shipments:update") && hasPermission(roleName, "bills:create"),
              canPay: hasPermission(roleName, "shipments:update") && hasPermission(roleName, "finance:create"),
            }}
          />
        </TabsContent>
        <TabsContent value="profit">
          <ProjectProfitTab projectId={project.id} />
        </TabsContent>
      </Tabs>

      {project.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="max-w-3xl whitespace-pre-wrap text-sm">{project.notes}</CardContent>
        </Card>
      )}
    </div>
  );
}
