"use client";

import { PageHeader, PageSkeleton, useToast } from "@bmp/ui";
import { useParams, useRouter } from "next/navigation";

import {
  OrganizationForm,
  type OrganizationFormValues,
} from "@/components/organizations/organization-form";
import { useOrganization, useUpdateOrganization } from "@/hooks/use-organizations";
import { useBreadcrumbLabel } from "@/lib/breadcrumb-store";

export default function EditOrganizationPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const organizationQuery = useOrganization(params.id);
  useBreadcrumbLabel(params.id, organizationQuery.data?.name);
  const updateOrganization = useUpdateOrganization(params.id);

  async function handleSubmit(values: OrganizationFormValues) {
    try {
      await updateOrganization.mutateAsync(values);
      toast({ title: "Organization updated" });
      router.push(`/organizations/${params.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update organization",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (organizationQuery.isLoading || !organizationQuery.data) {
    return <PageSkeleton className="max-w-3xl" />;
  }

  const organization = organizationQuery.data;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Edit organization" />
      <OrganizationForm
        defaultValues={{
          name: organization.name,
          type: organization.type,
          address: organization.address ?? "",
          city: organization.city ?? "",
          state: organization.state ?? "",
          pincode: organization.pincode ?? "",
          gstNumber: organization.gstNumber ?? "",
          website: organization.website ?? "",
          notes: organization.notes ?? "",
        }}
        onSubmit={handleSubmit}
        isSubmitting={updateOrganization.isPending}
        submitLabel="Save changes"
      />
    </div>
  );
}
