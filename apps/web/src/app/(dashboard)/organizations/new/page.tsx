"use client";

import { PageHeader, useToast } from "@bmp/ui";
import { useRouter } from "next/navigation";

import {
  OrganizationForm,
  type OrganizationFormValues,
} from "@/components/organizations/organization-form";
import { useCreateOrganization } from "@/hooks/use-organizations";

export default function NewOrganizationPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createOrganization = useCreateOrganization();

  async function handleSubmit(values: OrganizationFormValues) {
    try {
      const organization = await createOrganization.mutateAsync(values);
      toast({ title: "Organization created" });
      router.push(`/organizations/${organization.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create organization",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Add organization"
        description="Create a new client organization."
      />
      <OrganizationForm onSubmit={handleSubmit} isSubmitting={createOrganization.isPending} />
    </div>
  );
}
