"use client";

import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@bmp/ui";
import Link from "next/link";
import { useParams } from "next/navigation";

import { BillsTab } from "@/components/projects/bills-tab";
import { LaborEntriesTab } from "@/components/projects/labor-entries-tab";
import { MaterialUsageTab } from "@/components/projects/material-usage-tab";
import { MilestonesTab } from "@/components/projects/milestones-tab";
import { useProject, useProjectCosting, useProjectProgress } from "@/hooks/use-projects";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "default",
  ON_HOLD: "secondary",
  COMPLETED: "secondary",
  CANCELLED: "destructive",
};

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const projectQuery = useProject(params.id);
  const costingQuery = useProjectCosting(params.id);
  const progressQuery = useProjectProgress(params.id);

  if (projectQuery.isLoading || !projectQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const project = projectQuery.data;

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
          <Badge variant={STATUS_VARIANT[project.status]}>{project.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Budget: {project.budget.toLocaleString()} · Started{" "}
          {new Date(project.startDate).toLocaleDateString()}
          {" · "}
          <Link href={`/tenders/${project.tenderId}`} className="hover:underline">
            View source tender
          </Link>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Milestone progress</p>
            <p className="text-2xl font-semibold">{progressQuery.data?.milestoneProgressPercent ?? 0}%</p>
            <p className="text-xs text-muted-foreground">
              {progressQuery.data?.completedMilestones ?? 0}/{progressQuery.data?.totalMilestones ?? 0}{" "}
              milestones
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Days elapsed / remaining</p>
            <p className="text-2xl font-semibold">
              {progressQuery.data?.daysElapsed ?? "-"} / {progressQuery.data?.daysRemaining ?? "-"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total actual cost</p>
            <p className="text-2xl font-semibold">
              {costingQuery.data?.totalActualCost.toLocaleString() ?? "-"}
            </p>
            <p className="text-xs text-muted-foreground">
              PO: {costingQuery.data?.purchaseOrdersTotal.toLocaleString() ?? "-"} · Labor:{" "}
              {costingQuery.data?.laborTotal.toLocaleString() ?? "-"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Budget variance</p>
            <p
              className={`text-2xl font-semibold ${
                (costingQuery.data?.variance ?? 0) < 0 ? "text-destructive" : ""
              }`}
            >
              {costingQuery.data?.variance.toLocaleString() ?? "-"}
            </p>
            <p className="text-xs text-muted-foreground">
              BOQ estimate: {costingQuery.data?.boqEstimateTotal.toLocaleString() ?? "-"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="milestones">
        <TabsList>
          <TabsTrigger value="milestones">Milestones</TabsTrigger>
          <TabsTrigger value="material">Material</TabsTrigger>
          <TabsTrigger value="labor">Labor</TabsTrigger>
          <TabsTrigger value="bills">Bills</TabsTrigger>
        </TabsList>

        <TabsContent value="milestones">
          <MilestonesTab project={project} />
        </TabsContent>
        <TabsContent value="material">
          <MaterialUsageTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="labor">
          <LaborEntriesTab projectId={project.id} />
        </TabsContent>
        <TabsContent value="bills">
          <BillsTab projectId={project.id} />
        </TabsContent>
      </Tabs>

      {project.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{project.notes}</CardContent>
        </Card>
      )}
    </div>
  );
}
