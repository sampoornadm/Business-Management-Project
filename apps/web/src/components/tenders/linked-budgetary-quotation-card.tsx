"use client";

import type { TenderLinkedBudgetaryDto } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  formatDate,
  useToast,
} from "@bmp/ui";
import Link from "next/link";
import { useState } from "react";

import { TenderDownloadMenu } from "@/components/tenders/tender-download-menu";
import { useTenders, useUpdateTender } from "@/hooks/use-tenders";

export function LinkedBudgetaryQuotationCard({
  tenderId,
  clientId,
  convertedFrom,
}: {
  tenderId: string;
  clientId: string;
  convertedFrom: TenderLinkedBudgetaryDto | null;
}) {
  const { toast } = useToast();
  const updateTender = useUpdateTender(tenderId);
  const [picking, setPicking] = useState(false);

  const budgetaryQuery = useTenders({ kind: "BUDGETARY", clientId, pageSize: 50 });

  async function link(budgetaryTenderId: string | null) {
    try {
      await updateTender.mutateAsync({ convertedFromId: budgetaryTenderId || null });
      setPicking(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not link the budgetary quotation",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (convertedFrom && !picking) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <CardTitle className="text-base">Linked budgetary quotation</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>
              Change
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void link(null)}>
              Remove link
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <Link href={`/tenders/${convertedFrom.id}`} className="font-medium hover:underline">
              {convertedFrom.tenderNumber}
            </Link>
            <p className="text-sm text-muted-foreground">
              {convertedFrom.title} · updated {formatDate(convertedFrom.updatedAt)}
            </p>
          </div>
          <TenderDownloadMenu tenderId={convertedFrom.id} tenderNumber={convertedFrom.tenderNumber} size="sm" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Linked budgetary quotation</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Select onValueChange={(value) => void link(value)}>
          <SelectTrigger className="max-w-sm">
            <SelectValue placeholder="Link a prior budgetary quotation for this client..." />
          </SelectTrigger>
          <SelectContent>
            {budgetaryQuery.data?.items.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.tenderNumber} — {item.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {convertedFrom && (
          <Button variant="ghost" size="sm" onClick={() => setPicking(false)}>
            Cancel
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
