"use client";

import { PageHeader, Skeleton, useToast } from "@bmp/ui";
import { useParams, useRouter } from "next/navigation";

import { TenderForm, toCreateTenderInput, type TenderFormValues } from "@/components/tenders/tender-form";
import { useTender, useUpdateTender } from "@/hooks/use-tenders";

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function EditTenderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const tenderQuery = useTender(params.id);
  const updateTender = useUpdateTender(params.id);

  async function handleSubmit(values: TenderFormValues) {
    try {
      await updateTender.mutateAsync(toCreateTenderInput(values));
      toast({ title: "Tender updated" });
      router.push(`/tenders/${params.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update tender",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (tenderQuery.isLoading || !tenderQuery.data) {
    return <Skeleton className="h-96 w-full max-w-3xl" />;
  }

  const tender = tenderQuery.data;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Edit Tender" />
      <TenderForm
        defaultValues={{
          tenderNumber: tender.tenderNumber,
          title: tender.title,
          department: tender.department,
          clientId: tender.client.id,
          type: tender.type,
          category: tender.category,
          location: tender.location,
          state: tender.state,
          estimatedCost: String(tender.estimatedCost),
          emdAmount: tender.emdAmount != null ? String(tender.emdAmount) : "",
          tenderFee: tender.tenderFee != null ? String(tender.tenderFee) : "",
          documentFee: tender.documentFee != null ? String(tender.documentFee) : "",
          submissionDate: toDateInputValue(tender.submissionDate),
          openingDate: toDateInputValue(tender.openingDate),
          validityPeriodDays: tender.validityPeriodDays != null ? String(tender.validityPeriodDays) : "",
          priority: tender.priority,
          description: tender.description ?? "",
          remarks: tender.remarks ?? "",
          dealingOfficerName: tender.dealingOfficerName ?? "",
          dealingOfficerEmail: tender.dealingOfficerEmail ?? "",
          dealingOfficerPhone: tender.dealingOfficerPhone ?? "",
        }}
        onSubmit={handleSubmit}
        isSubmitting={updateTender.isPending}
        submitLabel="Save changes"
      />
    </div>
  );
}
