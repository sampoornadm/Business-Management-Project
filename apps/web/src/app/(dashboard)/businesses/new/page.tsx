"use client";

import { useToast } from "@bmp/ui";
import { useRouter } from "next/navigation";

import { BusinessForm, type BusinessFormValues } from "@/components/businesses/business-form";
import { useCreateBusiness } from "@/hooks/use-businesses";

export default function NewBusinessPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createBusiness = useCreateBusiness();

  async function handleSubmit(values: BusinessFormValues) {
    try {
      const business = await createBusiness.mutateAsync(values);
      toast({ title: "Business created" });
      router.push(`/businesses/${business.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create business",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add a business</h1>
        <p className="text-sm text-muted-foreground">
          Tenders, projects, and finance records are scoped to a business.
        </p>
      </div>
      <BusinessForm onSubmit={handleSubmit} isSubmitting={createBusiness.isPending} submitLabel="Create business" />
    </div>
  );
}
