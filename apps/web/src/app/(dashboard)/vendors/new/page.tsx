"use client";

import { useToast } from "@bmp/ui";
import { useRouter } from "next/navigation";

import { VendorForm, type VendorFormValues } from "@/components/vendors/vendor-form";
import { useCreateVendor } from "@/hooks/use-vendors";

export default function NewVendorPage() {
  const router = useRouter();
  const { toast } = useToast();
  const createVendor = useCreateVendor();

  async function handleSubmit(values: VendorFormValues) {
    try {
      const vendor = await createVendor.mutateAsync(values);
      toast({ title: "Vendor created" });
      router.push(`/vendors/${vendor.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create vendor",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Add Vendor</h1>
        <p className="text-sm text-muted-foreground">Register a new supplier or service provider.</p>
      </div>
      <VendorForm onSubmit={handleSubmit} isSubmitting={createVendor.isPending} />
    </div>
  );
}
