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
  CardHeader,
  CardTitle,
  EMPTY_VALUE,
  formatDate,
  Skeleton,
  Stepper,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@bmp/ui";
import { Download, Pencil, Receipt, ScrollText, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { ConvertToProjectDialog } from "@/components/projects/convert-to-project-dialog";
import { StatusChangeDialog } from "@/components/tenders/status-change-dialog";
import { TenderAssigneesTab } from "@/components/tenders/tender-assignees-tab";
import { TenderCompetitorsTab } from "@/components/tenders/tender-competitors-tab";
import { TenderDocumentsTab } from "@/components/tenders/tender-documents-tab";
import { TenderHistoryTab } from "@/components/tenders/tender-history-tab";
import { TenderItemsTab } from "@/components/tenders/tender-items-tab";
import { TenderNotesView } from "@/components/tenders/tender-notes-view";
import { TenderTagsCard } from "@/components/tenders/tender-tags-card";
import { downloadUndertaking } from "@/hooks/use-document-generation";
import { useTags } from "@/hooks/use-tags";
import { useChangeTenderStatus, useDeleteTender, useSetTenderTags, useTender } from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";
import { hasPermission } from "@/lib/permissions";
import { tenderPriorityBadgeVariant, tenderStatusBadgeVariant } from "@/lib/tender-status";
import { buildTenderSteps, isOnHappyPath } from "@/lib/tender-stepper";

export default function TenderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") ?? "overview";
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);

  const tenderQuery = useTender(params.id);
  const tagsQuery = useTags();
  useBreadcrumbLabel(params.id, tenderQuery.data?.title);
  const changeStatus = useChangeTenderStatus(params.id);
  const deleteTender = useDeleteTender();
  const setTags = useSetTenderTags(params.id);

  const canUpdate = hasPermission(roleName, "tenders:update");
  const canDelete = hasPermission(roleName, "tenders:delete");
  const canChangeStatus = hasPermission(roleName, "tenders:change_status");
  const canViewBoq = hasPermission(roleName, "boq:read");
  const canCreateProject = hasPermission(roleName, "projects:create");
  const canCreateBill = hasPermission(roleName, "bills:create");
  const canViewBills = hasPermission(roleName, "bills:read");
  const canGenerateDocument = hasPermission(roleName, "tenders:generate_document");

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

  async function handleGenerateUndertaking() {
    try {
      await downloadUndertaking(tender.id, tender.tenderNumber);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not generate document",
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
    <div className="space-y-6">
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
        <div className="flex flex-wrap justify-end gap-2">
          {canCreateProject && tender.status === "WON" && (
            <ConvertToProjectDialog tenderId={tender.id} />
          )}
          {canCreateBill && tender.status === "WON" && (
            <Button variant="outline" asChild>
              <Link href={`/bills/new?tenderId=${tender.id}`}>
                <Receipt className="mr-2 h-4 w-4" /> Create Bill
              </Link>
            </Button>
          )}
          {canViewBills && (
            <Button variant="outline" asChild>
              <Link href={`/bills?tenderId=${tender.id}`}>
                <ScrollText className="mr-2 h-4 w-4" /> View Bills
              </Link>
            </Button>
          )}
          {canChangeStatus && (
            <StatusChangeDialog currentStatus={tender.status} onSubmit={handleStatusChange} />
          )}
          {canGenerateDocument && (
            <Button variant="outline" onClick={handleGenerateUndertaking}>
              <Download className="mr-2 h-4 w-4" /> Generate Undertaking
            </Button>
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

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {canViewBoq && <TabsTrigger value="items">Items</TabsTrigger>}
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="assignees">Assignees ({tender.assigneeCount})</TabsTrigger>
          <TabsTrigger value="competitors">Competitors</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardContent className="grid grid-cols-1 gap-4 pt-6 text-sm sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
                <p>{tender.estimatedCost?.toLocaleString() ?? EMPTY_VALUE}</p>
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
                <p>{formatDate(tender.submissionDate)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Opening date</p>
                <p>{tender.openingDate ? formatDate(tender.openingDate) : "-"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Created by</p>
                <p>
                  {tender.createdBy.firstName} {tender.createdBy.lastName}
                </p>
              </div>
              {(tender.dealingOfficerName || tender.dealingOfficerEmail || tender.dealingOfficerPhone) && (
                <div>
                  <p className="text-muted-foreground">Dealing officer</p>
                  <p>
                    {[tender.dealingOfficerName, tender.dealingOfficerEmail, tender.dealingOfficerPhone]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              )}
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

          {tender.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Terms &amp; Notes</CardTitle>
              </CardHeader>
              <CardContent className="max-w-3xl pt-0">
                <TenderNotesView notes={tender.notes} />
              </CardContent>
            </Card>
          )}

          <TenderTagsCard
            allTags={tagsQuery.data ?? []}
            selectedTagIds={tender.tags.map((tag) => tag.id)}
            onChange={(tagIds) => setTags.mutate(tagIds)}
            canUpdate={canUpdate}
          />
        </TabsContent>

        {canViewBoq && (
          <TabsContent value="items">
            <TenderItemsTab tender={tender} />
          </TabsContent>
        )}

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
