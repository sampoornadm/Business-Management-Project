"use client";

import { Badge, Button, Card, CardContent, Skeleton, useToast } from "@bmp/ui";
import type { AxiosError } from "axios";
import { ArrowLeft, GitCompare, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { BoqItemGrid } from "@/components/boq/boq-item-grid";
import { BoqUploadPanel } from "@/components/boq/boq-upload-panel";
import { useBoqVersions, useCurrentBoq, useFinalizeBoq } from "@/hooks/use-boq";
import { useTender } from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

export default function TenderBoqPage() {
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canCreate = hasPermission(roleName, "boq:create");
  const canUpdate = hasPermission(roleName, "boq:update");

  const tenderQuery = useTender(params.id);
  const boqQuery = useCurrentBoq(params.id);
  const versionsQuery = useBoqVersions(params.id);
  const finalize = useFinalizeBoq(params.id);

  const [showReupload, setShowReupload] = useState(false);

  const notFound = (boqQuery.error as AxiosError | undefined)?.response?.status === 404;

  async function handleFinalize() {
    try {
      await finalize.mutateAsync();
      toast({ title: "BOQ finalized" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not finalize BOQ",
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
    <div className="max-w-6xl space-y-6">
      <div>
        <Link
          href={`/tenders/${tender.id}`}
          className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to {tender.tenderNumber}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">BOQ — {tender.title}</h1>
      </div>

      {boqQuery.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : notFound || showReupload ? (
        <BoqUploadPanel
          tenderId={tender.id}
          replacesBoqId={showReupload ? boqQuery.data?.id : undefined}
          onCommitted={() => setShowReupload(false)}
        />
      ) : boqQuery.data ? (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
              <div className="flex items-center gap-3">
                <Badge variant={boqQuery.data.status === "FINALIZED" ? "default" : "outline"}>
                  {boqQuery.data.status}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  Version {boqQuery.data.version} · {versionsQuery.data?.length ?? 1} version(s)
                </span>
                <span className="text-sm font-medium">
                  Total: {boqQuery.data.totalAmount.toLocaleString()}
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/tenders/${tender.id}/boq/compare`}>
                    <GitCompare className="mr-2 h-4 w-4" /> Compare
                  </Link>
                </Button>
                {canCreate && (
                  <Button variant="outline" size="sm" onClick={() => setShowReupload(true)}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Upload new version
                  </Button>
                )}
                {canUpdate && boqQuery.data.status === "DRAFT" && (
                  <Button size="sm" onClick={handleFinalize} disabled={finalize.isPending}>
                    Finalize
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <BoqItemGrid tenderId={tender.id} boq={boqQuery.data} />
        </>
      ) : null}
    </div>
  );
}
