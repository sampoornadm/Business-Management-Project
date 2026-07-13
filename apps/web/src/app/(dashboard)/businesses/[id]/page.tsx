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
import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

import { ContactDialog } from "@/components/organizations/contact-dialog";
import {
  useAddBusinessContact,
  useBusiness,
  useDeleteBusiness,
  useDeleteBusinessContact,
  useUpdateBusinessContact,
} from "@/hooks/use-businesses";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const MSME_LABELS: Record<string, string> = { MICRO: "Micro", SMALL: "Small", MEDIUM: "Medium" };

export default function BusinessDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);

  const businessQuery = useBusiness(params.id);
  const addContact = useAddBusinessContact(params.id);
  const updateContact = useUpdateBusinessContact(params.id);
  const deleteContact = useDeleteBusinessContact(params.id);
  const deleteBusiness = useDeleteBusiness();

  const canUpdate = hasPermission(roleName, "businesses:update");
  const canDelete = hasPermission(roleName, "businesses:delete");

  async function handleDelete() {
    try {
      await deleteBusiness.mutateAsync(params.id);
      toast({ title: "Business deleted" });
      router.push("/businesses");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete business",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (businessQuery.isLoading || !businessQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const business = businessQuery.data;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{business.name}</h1>
            <Badge variant={business.isActive ? "default" : "secondary"}>
              {business.isActive ? "Active" : "Inactive"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {[business.city, business.state].filter(Boolean).join(", ") || "No address on file"}
          </p>
        </div>
        {canUpdate && (
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/businesses/${business.id}/edit`}>
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
                    <AlertDialogTitle>Delete this business?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This can&apos;t be undone. Businesses with existing tenders can&apos;t be
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
            <p>{business.gstNumber || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">PAN Number</p>
            <p>{business.panNumber || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Udyam Registration Number</p>
            <p>{business.udyamRegistrationNumber || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">MSME Category</p>
            <p>{business.msmeCategory ? MSME_LABELS[business.msmeCategory] : "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Website</p>
            <p>{business.website || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Address</p>
            <p>{business.address || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pincode</p>
            <p>{business.pincode || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Tenders</p>
            <p>{business.tenderCount}</p>
          </div>
        </CardContent>
      </Card>

      {business.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{business.notes}</CardContent>
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
          {business.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts added yet.</p>
          ) : (
            business.contacts.map((contact) => (
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
    </div>
  );
}
