"use client";

import { Skeleton, useToast } from "@bmp/ui";
import { useParams, useRouter } from "next/navigation";

import { VendorForm, type VendorFormValues } from "@/components/vendors/vendor-form";
import { useUpdateVendor, useVendor } from "@/hooks/use-vendors";

export default function EditVendorPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const vendorQuery = useVendor(params.id);
  const updateVendor = useUpdateVendor(params.id);

  async function handleSubmit(values: VendorFormValues) {
    try {
      await updateVendor.mutateAsync(values);
      toast({ title: "Vendor updated" });
      router.push(`/vendors/${params.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update vendor",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (vendorQuery.isLoading || !vendorQuery.data) {
    return <Skeleton className="h-96 w-full max-w-2xl" />;
  }

  const vendor = vendorQuery.data;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Edit Vendor</h1>
      </div>
      <VendorForm
        defaultValues={{
          name: vendor.name,
          category: vendor.category,
          gstNumber: vendor.gstNumber ?? "",
          panNumber: vendor.panNumber ?? "",
          address: vendor.address ?? "",
          city: vendor.city ?? "",
          state: vendor.state ?? "",
          bankAccountName: vendor.bankAccountName ?? "",
          bankAccountNumber: vendor.bankAccountNumber ?? "",
          bankIfscCode: vendor.bankIfscCode ?? "",
          notes: vendor.notes ?? "",
        }}
        onSubmit={handleSubmit}
        isSubmitting={updateVendor.isPending}
        submitLabel="Save changes"
      />
    </div>
  );
}
