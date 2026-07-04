"use client";

import { useToast } from "@bmp/ui";
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
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add Organization</h1>
        <p className="text-sm text-muted-foreground">Create a new client organization.</p>
      </div>
      <OrganizationForm onSubmit={handleSubmit} isSubmitting={createOrganization.isPending} />
    </div>
  );
}
