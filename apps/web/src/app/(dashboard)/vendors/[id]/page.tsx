"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
  useToast,
} from "@bmp/ui";
import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { ContactDialog } from "@/components/vendors/contact-dialog";
import {
  useAddVendorContact,
  useDeleteVendor,
  useDeleteVendorContact,
  useUpdateVendorContact,
  useVendor,
  useVendorPerformance,
} from "@/hooks/use-vendors";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const CATEGORY_LABELS: Record<string, string> = {
  MATERIAL_SUPPLIER: "Material Supplier",
  SERVICE_PROVIDER: "Service Provider",
  SUBCONTRACTOR: "Subcontractor",
  EQUIPMENT_RENTAL: "Equipment Rental",
};

export default function VendorDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);

  const vendorQuery = useVendor(params.id);
  const performanceQuery = useVendorPerformance(params.id);
  const addContact = useAddVendorContact(params.id);
  const updateContact = useUpdateVendorContact(params.id);
  const deleteContact = useDeleteVendorContact(params.id);
  const deleteVendor = useDeleteVendor();

  const canUpdate = hasPermission(roleName, "vendors:update");
  const canDelete = hasPermission(roleName, "vendors:delete");

  async function handleDelete() {
    try {
      await deleteVendor.mutateAsync(params.id);
      toast({ title: "Vendor deleted" });
      router.push("/vendors");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete vendor",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (vendorQuery.isLoading || !vendorQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const vendor = vendorQuery.data;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{vendor.name}</h1>
            <Badge variant="outline">{CATEGORY_LABELS[vendor.category]}</Badge>
            <Badge variant={vendor.isActive ? "default" : "secondary"}>
              {vendor.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {[vendor.city, vendor.state].filter(Boolean).join(", ") || "No address on file"}
          </p>
        </div>
        {canUpdate && (
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/vendors/${vendor.id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </Link>
            </Button>
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this vendor?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This can&apos;t be undone. Vendors referenced by any purchase order can&apos;t be
                      deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-muted-foreground">GST Number</p>
            <p>{vendor.gstNumber || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">PAN Number</p>
            <p>{vendor.panNumber || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Address</p>
            <p>{vendor.address || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Bank Account</p>
            <p>
              {vendor.bankAccountName
                ? `${vendor.bankAccountName} · ${vendor.bankAccountNumber ?? "-"} · ${vendor.bankIfscCode ?? "-"}`
                : "-"}
            </p>
          </div>
        </CardContent>
      </Card>

      {vendor.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{vendor.notes}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Contacts</CardTitle>
          {canUpdate && (
            <ContactDialog
              trigger={
                <Button size="sm" variant="outline">
                  <Plus className="mr-2 h-4 w-4" /> Add contact
                </Button>
              }
              onSubmit={async (values) => {
                await addContact.mutateAsync(values);
                toast({ title: "Contact added" });
              }}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {vendor.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts added yet.</p>
          ) : (
            vendor.contacts.map((contact) => (
              <div
                key={contact.id}
                className="flex items-center justify-between gap-4 rounded-md border p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{contact.name}</p>
                    {contact.isPrimary && <Badge variant="secondary">Primary</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[contact.designation, contact.email, contact.phone].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {canUpdate && (
                  <div className="flex gap-2">
                    <ContactDialog
                      contact={contact}
                      trigger={
                        <Button size="sm" variant="ghost">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      }
                      onSubmit={async (values) => {
                        await updateContact.mutateAsync({ contactId: contact.id, input: values });
                        toast({ title: "Contact updated" });
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await deleteContact.mutateAsync(contact.id);
                        toast({ title: "Contact removed" });
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {performanceQuery.data && performanceQuery.data.totalRatings > 0 ? (
            <>
              <p className="flex items-center gap-1 text-sm font-medium">
                <Star className="h-4 w-4 fill-current text-amber-500" />
                {performanceQuery.data.averageRating} average over {performanceQuery.data.totalRatings}{" "}
                purchase order(s)
              </p>
              <div className="space-y-2">
                {performanceQuery.data.ratings.map((rating) => (
                  <div key={rating.id} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1 font-medium">
                        <Star className="h-3.5 w-3.5 fill-current text-amber-500" /> {rating.rating}/5
                      </span>
                      <span className="text-muted-foreground">
                        by {rating.ratedBy.firstName} {rating.ratedBy.lastName}
                      </span>
                    </div>
                    {rating.remarks && <p className="mt-1 text-muted-foreground">{rating.remarks}</p>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No ratings yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
