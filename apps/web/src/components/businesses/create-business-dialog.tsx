"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
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
  useToast,
} from "@bmp/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Briefcase } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useCreateBusiness } from "@/hooks/use-businesses";

const schema = z.object({
  name: z.string().min(1, "Required").max(200, "Max 200 characters"),
  code: z.string().min(1, "Required").max(20, "Max 20 characters"),
});
type FormValues = z.infer<typeof schema>;

export function CreateBusinessDialog() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const createBusiness = useCreateBusiness();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", code: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      await createBusiness.mutateAsync(values);
      toast({ title: "Business created", description: `${values.name} has been added.` });
      form.reset();
      setOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create business",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Briefcase className="mr-2 h-4 w-4" /> Add Business
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a new business</DialogTitle>
          <DialogDescription>
            Tenders, projects, and finance records are scoped to a business.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
              name="code"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="submit" disabled={createBusiness.isPending}>
                {createBusiness.isPending ? "Creating..." : "Create business"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
