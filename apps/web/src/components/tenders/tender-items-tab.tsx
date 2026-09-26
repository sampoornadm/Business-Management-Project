"use client";

import type { TenderDto } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  Input,
  Skeleton,
  useToast,
} from "@bmp/ui";
import type { AxiosError } from "axios";
import { GitCompare, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { BoqItemGrid } from "@/components/boq/boq-item-grid";
import { BoqUploadPanel } from "@/components/boq/boq-upload-panel";
import { useAddBoqItem, useBoqVersions, useCurrentBoq } from "@/hooks/use-boq";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

function AddItemForm({ tenderId }: { tenderId: string }) {
  const { toast } = useToast();
  const addItem = useAddBoqItem(tenderId);
  const [description, setDescription] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");

  async function handleAdd() {
    if (!description.trim()) {
      toast({ variant: "destructive", title: "Enter a description" });
      return;
    }
    try {
      await addItem.mutateAsync({
        description: description.trim(),
        unit: unit.trim() || undefined,
        quantity: quantity.trim() ? Number(quantity) : undefined,
      });
      setDescription("");
      setUnit("");
      setQuantity("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not add item",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
      <div className="min-w-[16rem] flex-1 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Description</label>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Item description"
        />
      </div>
      <div className="w-24 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Unit</label>
        <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="EA" />
      </div>
      <div className="w-28 space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Quantity</label>
        <Input
          type="number"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder="0"
        />
      </div>
      <Button onClick={() => void handleAdd()} disabled={addItem.isPending}>
        <Plus className="mr-2 h-4 w-4" /> Add item
      </Button>
    </div>
  );
}

export function TenderItemsTab({ tender }: { tender: TenderDto }) {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canCreate = hasPermission(roleName, "boq:create");

  const boqQuery = useCurrentBoq(tender.id);
  const versionsQuery = useBoqVersions(tender.id);

  const [showReupload, setShowReupload] = useState(false);

  const notFound = (boqQuery.error as AxiosError | undefined)?.response?.status === 404;

  if (boqQuery.isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (notFound || showReupload) {
    return (
      <div className="space-y-4">
        {canCreate && !showReupload && (
          <AddItemForm tenderId={tender.id} />
        )}
        <BoqUploadPanel
          tenderId={tender.id}
          replacesBoqId={showReupload ? boqQuery.data?.id : undefined}
          onCommitted={() => setShowReupload(false)}
        />
      </div>
    );
  }

  if (!boqQuery.data) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
              Version {boqQuery.data.version} · {versionsQuery.data?.length ?? 1} version(s)
            </span>
            <span className="text-sm font-medium">Total: {boqQuery.data.totalAmount.toLocaleString()}</span>
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
          </div>
        </CardContent>
      </Card>

      {canCreate && <AddItemForm tenderId={tender.id} />}

      <BoqItemGrid tenderId={tender.id} boq={boqQuery.data} />
    </div>
  );
}
