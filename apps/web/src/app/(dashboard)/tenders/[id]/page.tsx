"use client";

import { TENDER_KIND_LABELS } from "@bmp/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DeadlineProgress,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EMPTY_VALUE,
  formatDate,
  formatDateTime,
  formatMoney,
  PageHeader,
  PageSkeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useToast,
} from "@bmp/ui";
import { MoreHorizontal, Pencil, Receipt, ScrollText, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { ConvertToProjectDialog } from "@/components/projects/convert-to-project-dialog";
import { humanize } from "@/components/status-badge";
import { LinkedBudgetaryQuotationCard } from "@/components/tenders/linked-budgetary-quotation-card";
import { PinnedTenderNotes } from "@/components/tenders/pinned-tender-notes";
import { OpenPortalBrowserButton, PortalFillButton } from "@/components/tenders/portal-fill-button";
import { TenderAssigneesTab } from "@/components/tenders/tender-assignees-tab";
import { TenderCompetitorsTab } from "@/components/tenders/tender-competitors-tab";
import { TenderDocumentsTab } from "@/components/tenders/tender-documents-tab";
import { TenderDownloadMenu } from "@/components/tenders/tender-download-menu";
import { TenderHistoryTab } from "@/components/tenders/tender-history-tab";
import { TenderItemsTab } from "@/components/tenders/tender-items-tab";
import { TenderNotesView } from "@/components/tenders/tender-notes-view";
import { TenderStatusTracker } from "@/components/tenders/tender-status-tracker";
import { TenderTagsCard } from "@/components/tenders/tender-tags-card";
import { useTags } from "@/hooks/use-tags";
import {
  useDeleteTender,
  usePinTenderNote,
  useSetTenderTags,
  useTender,
  useUnpinTenderNote,
} from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";
import { daysUntil, timeLeftLabel, isPastDue } from "@/lib/deadline";
import { hasPermission } from "@/lib/permissions";
import { tenderKindBadgeVariant, tenderPriorityBadgeVariant } from "@/lib/tender-status";

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
  const deleteTender = useDeleteTender();
  const setTags = useSetTenderTags(params.id);
  const pinNote = usePinTenderNote(params.id);
  const unpinNote = useUnpinTenderNote(params.id);
  const [pendingLineText, setPendingLineText] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const canUpdate = hasPermission(roleName, "tenders:update");
  const canDelete = hasPermission(roleName, "tenders:delete");
  const canChangeStatus = hasPermission(roleName, "tenders:change_status");
  const canRevertStatus = hasPermission(roleName, "tenders:revert_status");
  const canViewBoq = hasPermission(roleName, "boq:read");
  const canCreateProject = hasPermission(roleName, "projects:create");
  const canCreateBill = hasPermission(roleName, "bills:create");
  const canViewBills = hasPermission(roleName, "bills:read");
  const canGenerateDocument = hasPermission(roleName, "tenders:generate_document");
  const canFillPortal = hasPermission(roleName, "tenders:fill_portal");

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

  async function handleTogglePin(lineText: string, pinnedNoteId?: string) {
    setPendingLineText(lineText);
    try {
      if (pinnedNoteId) {
        await unpinNote.mutateAsync(pinnedNoteId);
      } else {
        await pinNote.mutateAsync({ lineText });
      }
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update pin",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setPendingLineText(null);
    }
  }

  if (tenderQuery.isLoading || !tenderQuery.data) {
    return <PageSkeleton />;
  }

  const tender = tenderQuery.data;

  // Header actions follow the tender's stage: the one filled button is the next step
  // (fill the bid while Draft, bill once Won); rarely used actions sit in the "More" menu.
  const isDraft = tender.status === "DRAFT";
  const isWon = tender.status === "WON";
  // Portal bid actions only matter until a result is in.
  const bidOpen = isDraft || tender.status === "SUBMITTED";
  const showPortalInMenu = canFillPortal && bidOpen && !isDraft;
  const showDelete = canDelete && isDraft;
  const hasMoreActions = canViewBills || showPortalInMenu || showDelete;

  return (
    <div className="space-y-6">
      <PageHeader
        title={tender.title}
        badges={
          <>
            {tender.kind === "BUDGETARY" && (
              <Badge variant={tenderKindBadgeVariant(tender.kind)}>{TENDER_KIND_LABELS.BUDGETARY}</Badge>
            )}
            <Badge variant={tenderPriorityBadgeVariant(tender.priority)}>{humanize(tender.priority)}</Badge>
            {tender.deliveryPeriodNeedsReview && (
              <Badge variant="signal">
                Check delivery period: tender asks {tender.tenderDeliveryDays} days, we offer{" "}
                {tender.deliveryPeriodDays}
              </Badge>
            )}
          </>
        }
        actions={
          <>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              {hasMoreActions && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon" aria-label="More actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canViewBills && (
                      <DropdownMenuItem asChild>
                        <Link href={`/bills?tenderId=${tender.id}`}>
                          <ScrollText className="mr-2 h-4 w-4" /> View bills
                        </Link>
                      </DropdownMenuItem>
                    )}
                    {showPortalInMenu && <OpenPortalBrowserButton menuItem />}
                    {showDelete && (
                      <>
                        {(canViewBills || showPortalInMenu) && <DropdownMenuSeparator />}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() => setDeleteOpen(true)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete tender
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {canUpdate && (
                <Button variant="outline" asChild>
                  <Link href={`/tenders/${tender.id}/edit`}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit
                  </Link>
                </Button>
              )}
              {canGenerateDocument && <TenderDownloadMenu tenderId={tender.id} tenderNumber={tender.tenderNumber} />}
              {canFillPortal && isDraft && <OpenPortalBrowserButton />}
              {canFillPortal && bidOpen && (
                <PortalFillButton tenderId={tender.id} variant={isDraft ? "default" : "outline"} />
              )}
              {canCreateProject && isWon && <ConvertToProjectDialog tenderId={tender.id} />}
              {canCreateBill && isWon && (
                <Button asChild>
                  <Link href={`/bills/new?tenderId=${tender.id}`}>
                    <Receipt className="mr-2 h-4 w-4" /> Create bill
                  </Link>
                </Button>
              )}
            </div>
            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
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
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          {tender.tenderNumber} · {tender.client.name}
        </p>
        <div className="mt-3">
          <TenderStatusTracker
            tender={tender}
            canChange={canChangeStatus}
            canRevert={canRevertStatus}
            canViewBoq={canViewBoq}
          />
        </div>
      </PageHeader>

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
                <p>{formatMoney(tender.estimatedCost)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">EMD / Tender fee / Doc fee</p>
                <p>
                  {formatMoney(tender.emdAmount)} / {formatMoney(tender.tenderFee)} /{" "}
                  {formatMoney(tender.documentFee)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Submission date</p>
                {tender.submissionDate ? (
                  <DeadlineProgress
                    dateText={formatDateTime(tender.submissionDate)}
                    daysLeft={daysUntil(tender.submissionDate)}
                    label={timeLeftLabel(tender.submissionDate)}
                    pastDue={isPastDue(tender.submissionDate)}
                  />
                ) : (
                  <p>{EMPTY_VALUE}</p>
                )}
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
                    {[tender.dealingOfficerName, tender.dealingOfficerPhone].filter(Boolean).join(" · ")}
                    {tender.dealingOfficerEmail && (
                      <>
                        {(tender.dealingOfficerName || tender.dealingOfficerPhone) && " · "}
                        <a
                          href={`mailto:${tender.dealingOfficerEmail}`}
                          className="text-primary hover:underline"
                        >
                          {tender.dealingOfficerEmail}
                        </a>
                      </>
                    )}
                  </p>
                </div>
              )}
              {tender.winnerName && (
                <div>
                  <p className="text-muted-foreground">Winner</p>
                  <p>
                    {tender.winnerName}
                    {tender.winningBidAmount ? ` · ${formatMoney(tender.winningBidAmount)}` : ""}
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
              <CardContent className="pt-0">
                <PinnedTenderNotes
                  pinnedNotes={tender.pinnedNotes}
                  pendingLineText={pendingLineText}
                  onUnpin={
                    canUpdate
                      ? (note) => handleTogglePin(note.lineText, note.id)
                      : undefined
                  }
                />
                <TenderNotesView
                  notes={tender.notes}
                  pinnedLineTexts={new Set(tender.pinnedNotes.map((note) => note.lineText))}
                  pendingLineText={pendingLineText}
                  onTogglePin={
                    canUpdate
                      ? (lineText) => {
                          const existing = tender.pinnedNotes.find((note) => note.lineText === lineText);
                          void handleTogglePin(lineText, existing?.id);
                        }
                      : undefined
                  }
                />
              </CardContent>
            </Card>
          )}

          <TenderTagsCard
            allTags={tagsQuery.data ?? []}
            selectedTagIds={tender.tags.map((tag) => tag.id)}
            onChange={(tagIds) => setTags.mutate(tagIds)}
            canUpdate={canUpdate}
          />

          {tender.kind === "TENDER" && canUpdate && (
            <LinkedBudgetaryQuotationCard
              tenderId={tender.id}
              clientId={tender.client.id}
              convertedFrom={tender.convertedFrom}
            />
          )}
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
