"use client";

import { Skeleton, useToast } from "@bmp/ui";
import { useParams, useRouter } from "next/navigation";

import { BusinessForm, type BusinessFormValues } from "@/components/businesses/business-form";
import { useBusiness, useUpdateBusiness } from "@/hooks/use-businesses";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";

export default function EditBusinessPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const businessQuery = useBusiness(params.id);
  useBreadcrumbLabel(params.id, businessQuery.data?.name);
  const updateBusiness = useUpdateBusiness(params.id);

  async function handleSubmit(values: BusinessFormValues) {
    try {
      await updateBusiness.mutateAsync(values);
      toast({ title: "Business updated" });
      router.push(`/businesses/${params.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update business",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (businessQuery.isLoading || !businessQuery.data) {
    return <Skeleton className="h-96 w-full max-w-3xl" />;
  }

  const business = businessQuery.data;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit Business</h1>
      </div>
      <BusinessForm
        defaultValues={{
          name: business.name,
          code: business.code,
          address: business.address ?? "",
          city: business.city ?? "",
          state: business.state ?? "",
          pincode: business.pincode ?? "",
          gstNumber: business.gstNumber ?? "",
          udyamRegistrationNumber: business.udyamRegistrationNumber ?? "",
          msmeCategory: business.msmeCategory ?? undefined,
          panNumber: business.panNumber ?? "",
          website: business.website ?? "",
          notes: business.notes ?? "",
          isActive: business.isActive,
        }}
        onSubmit={handleSubmit}
        isSubmitting={updateBusiness.isPending}
        submitLabel="Save changes"
        showActiveToggle
      />
    </div>
  );
}
