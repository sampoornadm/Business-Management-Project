"use client";

import type { TenderDto } from "@bmp/types";
import {
  Badge,
  Button,
  Checkbox,
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
  useToast,
} from "@bmp/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useAddTenderCompetitor, useDeleteTenderCompetitor } from "@/hooks/use-tenders";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

const competitorSchema = z.object({
  competitorName: z.string().min(1, "Required"),
  bidAmount: z.union([z.string(), z.number()]).optional(),
  isWinningBid: z.boolean().optional(),
  remarks: z.string().optional(),
});
type CompetitorFormValues = z.infer<typeof competitorSchema>;

export function TenderCompetitorsTab({ tender }: { tender: TenderDto }) {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canEdit = hasPermission(roleName, "tenders:update");
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const addCompetitor = useAddTenderCompetitor(tender.id);
  const deleteCompetitor = useDeleteTenderCompetitor(tender.id);

  const form = useForm<CompetitorFormValues>({
    resolver: zodResolver(competitorSchema),
    defaultValues: { competitorName: "", bidAmount: "", isWinningBid: false, remarks: "" },
  });

  async function handleSubmit(values: CompetitorFormValues) {
    try {
      await addCompetitor.mutateAsync({
        competitorName: values.competitorName,
        bidAmount: values.bidAmount ? Number(values.bidAmount) : undefined,
        isWinningBid: values.isWinningBid,
        remarks: values.remarks || undefined,
      });
      toast({ title: "Competitor added" });
      form.reset();
      setOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not add competitor",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleDelete(competitorId: string) {
    await deleteCompetitor.mutateAsync(competitorId);
    toast({ title: "Competitor removed" });
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline">
              <Plus className="mr-2 h-4 w-4" /> Add competitor
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add competitor</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="competitorName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Competitor name</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="bidAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bid amount</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="isWinningBid"
                  render={({ field }) => (
                    <FormItem className="flex flex-row items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <FormLabel className="!mt-0">This was the winning bid</FormLabel>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="remarks"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Remarks</FormLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="submit">Save</Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      )}

      {tender.competitors.length === 0 ? (
        <p className="text-sm text-muted-foreground">No competitor information recorded.</p>
      ) : (
        <div className="space-y-2">
          {tender.competitors.map((competitor) => (
            <div key={competitor.id} className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{competitor.competitorName}</p>
                  {competitor.isWinningBid && <Badge>Winning bid</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {competitor.bidAmount ? `Bid: ${competitor.bidAmount.toLocaleString()}` : "No bid amount"}
                  {competitor.remarks ? ` · ${competitor.remarks}` : ""}
                </p>
              </div>
              {canEdit && (
                <Button size="sm" variant="ghost" onClick={() => handleDelete(competitor.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
