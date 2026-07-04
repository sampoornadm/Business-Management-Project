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
  useAddOrganizationContact,
  useDeleteOrganization,
  useDeleteOrganizationContact,
  useOrganization,
  useUpdateOrganizationContact,
} from "@/hooks/use-organizations";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

export default function OrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();
  const roleName = useAuthStore((state) => state.user?.role.name);

  const organizationQuery = useOrganization(params.id);
  const addContact = useAddOrganizationContact(params.id);
  const updateContact = useUpdateOrganizationContact(params.id);
  const deleteContact = useDeleteOrganizationContact(params.id);
  const deleteOrganization = useDeleteOrganization();

  const canUpdate = hasPermission(roleName, "organizations:update");
  const canDelete = hasPermission(roleName, "organizations:delete");

  async function handleDelete() {
    try {
      await deleteOrganization.mutateAsync(params.id);
      toast({ title: "Organization deleted" });
      router.push("/organizations");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not delete organization",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  if (organizationQuery.isLoading || !organizationQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const organization = organizationQuery.data;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
            <Badge variant={organization.type === "GOVERNMENT" ? "secondary" : "outline"}>
              {organization.type === "GOVERNMENT" ? "Government" : "Private"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {[organization.city, organization.state].filter(Boolean).join(", ") || "No address on file"}
          </p>
        </div>
        {canUpdate && (
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/organizations/${organization.id}/edit`}>
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
                    <AlertDialogTitle>Delete this organization?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This can&apos;t be undone. Organizations referenced by any tender can&apos;t be
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
            <p>{organization.gstNumber || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Website</p>
            <p>{organization.website || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Address</p>
            <p>{organization.address || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Pincode</p>
            <p>{organization.pincode || "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Tenders</p>
            <p>{organization.tenderCount}</p>
          </div>
        </CardContent>
      </Card>

      {organization.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{organization.notes}</CardContent>
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
          {organization.contacts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contacts added yet.</p>
          ) : (
            organization.contacts.map((contact) => (
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
