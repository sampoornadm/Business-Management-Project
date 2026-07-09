"use client";

import { ORGANIZATION_TYPES, type OrganizationDto } from "@bmp/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useCreateOrganization } from "@/hooks/use-organizations";

const createOrganizationSchema = z.object({
  name: z.string().min(1, "Required"),
  type: z.enum(ORGANIZATION_TYPES),
});
type CreateOrganizationFormValues = z.infer<typeof createOrganizationSchema>;

export interface CreateOrganizationDialogProps {
  trigger: ReactNode;
  defaultName?: string;
  onCreated: (organization: OrganizationDto) => void;
}

// Minimal by design — just enough to unblock creating the tender. Address,
// GST, contacts etc. can be filled in later from the Organizations page.
export function CreateOrganizationDialog({ trigger, defaultName, onCreated }: CreateOrganizationDialogProps) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const createOrganization = useCreateOrganization();

  const form = useForm<CreateOrganizationFormValues>({
    resolver: zodResolver(createOrganizationSchema),
    defaultValues: { name: defaultName ?? "", type: "GOVERNMENT" },
  });

  useEffect(() => {
    if (open) form.reset({ name: defaultName ?? "", type: "GOVERNMENT" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultName]);

  async function handleSubmit(values: CreateOrganizationFormValues) {
    try {
      const organization = await createOrganization.mutateAsync(values);
      toast({ title: "Organization created" });
      onCreated(organization);
      setOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create organization",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create organization</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ORGANIZATION_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          {type === "GOVERNMENT" ? "Government" : "Private"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={createOrganization.isPending}>
                {createOrganization.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
