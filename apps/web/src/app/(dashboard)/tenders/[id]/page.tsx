"use client";

import { TENDER_STATUS_LABELS } from "@bmp/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  MultiSelect,
  Skeleton,
  Stepper,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@bmp/ui";
import { FileSpreadsheet, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { ConvertToProjectDialog } from "@/components/projects/convert-to-project-dialog";
import { StatusChangeDialog } from "@/components/tenders/status-change-dialog";
import { TenderAssigneesTab } from "@/components/tenders/tender-assignees-tab";
import { TenderCompetitorsTab } from "@/components/tenders/tender-competitors-tab";
import { TenderDocumentsTab } from "@/components/tenders/tender-documents-tab";
import { TenderHistoryTab } from "@/components/tenders/tender-history-tab";
import { useTags } from "@/hooks/use-tags";
import { useChangeTenderStatus, useDeleteTender, useSetTenderTags, useTender } from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";
import { tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "@/lib/tender-status";
import { buildTenderSteps, isOnHappyPath } from "@/lib/tender-stepper";

export default function TenderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);

  const tenderQuery = useTender(params.id);
  const tagsQuery = useTags();
  const changeStatus = useChangeTenderStatus(params.id);
  const deleteTender = useDeleteTender();
  const setTags = useSetTenderTags(params.id);

  const canUpdate = hasPermission(roleName, "tenders:update");
  const canDelete = hasPermission(roleName, "tenders:delete");
  const canChangeStatus = hasPermission(roleName, "tenders:change_status");
  const canViewBoq = hasPermission(roleName, "boq:read");
  const canCreateProject = hasPermission(roleName, "projects:create");

  async function handleStatusChange(values: Parameters<typeof changeStatus.mutateAsync>[0]) {
    try {
      await changeStatus.mutateAsync(values);
      toast({ title: "Status updated" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not change status",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleDelete() {
    try {
      await deleteTender.mutateAsync(params.id);
      toast({ title: "Tender deleted" });
      router.push("/tenders");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete tender",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (tenderQuery.isLoading || !tenderQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const tender = tenderQuery.data;

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{tender.title}</h1>
            <Badge variant={tenderStatusBadgeVariant(tender.status)}>
              {TENDER_STATUS_LABELS[tender.status]}
            </Badge>
            <Badge variant={tenderPriorityBadgeVariant(tender.priority)}>{tender.priority}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {tender.tenderNumber} · {tender.client.name}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {canViewBoq && (
            <Button variant="outline" asChild>
              <Link href={`/tenders/${tender.id}/boq`}>
                <FileSpreadsheet className="mr-2 h-4 w-4" /> BOQ
              </Link>
            </Button>
          )}
          {canCreateProject && tender.status === "WON" && (
            <ConvertToProjectDialog tenderId={tender.id} />
          )}
          {canChangeStatus && (
            <StatusChangeDialog currentStatus={tender.status} onSubmit={handleStatusChange} />
          )}
          {canUpdate && (
            <Button variant="outline" asChild>
              <Link href={`/tenders/${tender.id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </Link>
            </Button>
          )}
          {canDelete && tender.status === "DRAFT" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this tender?</AlertDialogTitle>
                  <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {isOnHappyPath(tender.status) ? (
        <Card>
          <CardContent className="pt-6">
            <Stepper steps={buildTenderSteps(tender.status)} />
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="assignees">Assignees ({tender.assigneeCount})</TabsTrigger>
          <TabsTrigger value="competitors">Competitors</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm">
              <div>
                <p className="text-muted-foreground">Department</p>
                <p>{tender.department}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Type / Category</p>
                <p>
                  {tender.type} / {tender.category}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Location</p>
                <p>
                  {tender.location}, {tender.state}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Estimated cost</p>
                <p>{tender.estimatedCost.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">EMD / Tender fee / Doc fee</p>
                <p>
                  {tender.emdAmount?.toLocaleString() ?? "-"} / {tender.tenderFee?.toLocaleString() ?? "-"} /{" "}
                  {tender.documentFee?.toLocaleString() ?? "-"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Submission date</p>
                <p>{new Date(tender.submissionDate).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Opening date</p>
                <p>{tender.openingDate ? new Date(tender.openingDate).toLocaleDateString() : "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created by</p>
                <p>
                  {tender.createdBy.firstName} {tender.createdBy.lastName}
                </p>
              </div>
              {tender.winnerName && (
                <div>
                  <p className="text-muted-foreground">Winner</p>
                  <p>
                    {tender.winnerName}
                    {tender.winningBidAmount ? ` · ${tender.winningBidAmount.toLocaleString()}` : ""}
                  </p>
                </div>
              )}
              {tender.lossReason && (
                <div>
                  <p className="text-muted-foreground">Loss reason</p>
                  <p>{tender.lossReason}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {tender.description && (
            <Card>
              <CardContent className="whitespace-pre-wrap pt-6 text-sm">{tender.description}</CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-2 pt-6">
              <p className="text-sm font-medium">Tags</p>
              <MultiSelect
                options={(tagsQuery.data ?? []).map((tag) => ({ value: tag.id, label: tag.name }))}
                selected={tender.tags.map((tag) => tag.id)}
                onChange={(tagIds) => setTags.mutate(tagIds)}
                placeholder="Add tags"
                className="max-w-sm"
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <TenderDocumentsTab tenderId={tender.id} />
        </TabsContent>

        <TabsContent value="assignees">
          <TenderAssigneesTab tender={tender} />
        </TabsContent>

        <TabsContent value="competitors">
          <TenderCompetitorsTab tender={tender} />
        </TabsContent>

        <TabsContent value="history">
          <TenderHistoryTab tenderId={tender.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
