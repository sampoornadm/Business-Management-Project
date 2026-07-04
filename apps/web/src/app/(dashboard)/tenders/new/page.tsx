"use client";

import { useToast } from "@bmp/ui";
import { useRouter } from "next/navigation";

import { TenderForm, toCreateTenderInput, type TenderFormValues } from "@/components/tenders/tender-form";
import { useCreateTender } from "@/hooks/use-tenders";

export default function NewTenderPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createTender = useCreateTender();

  async function handleSubmit(values: TenderFormValues) {
    try {
      const tender = await createTender.mutateAsync(toCreateTenderInput(values));
      toast({ title: "Tender created" });
      router.push(`/tenders/${tender.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create tender",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">New Tender</h1>
        <p className="text-sm text-muted-foreground">Create a new tender record.</p>
      </div>
      <TenderForm onSubmit={handleSubmit} isSubmitting={createTender.isPending} submitLabel="Create tender" />
    </div>
  );
}
