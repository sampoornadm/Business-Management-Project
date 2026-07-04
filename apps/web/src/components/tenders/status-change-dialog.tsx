"use client";

import { TENDER_STATUS_LABELS, TENDER_STATUS_TRANSITIONS, type TenderStatus } from "@bmp/types";
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
  Textarea,
} from "@bmp/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  status: z.string().min(1, "Select a status"),
  remarks: z.string().optional(),
  winnerName: z.string().optional(),
  winningBidAmount: z.union([z.string(), z.number()]).optional(),
  lossReason: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export interface StatusChangeDialogProps {
  currentStatus: TenderStatus;
  onSubmit: (values: {
    status: TenderStatus;
    remarks?: string;
    winnerName?: string;
    winningBidAmount?: number;
    lossReason?: string;
  }) => Promise<void>;
}

export function StatusChangeDialog({ currentStatus, onSubmit }: StatusChangeDialogProps) {
  const [open, setOpen] = useState(false);
  const allowedNext = TENDER_STATUS_TRANSITIONS[currentStatus];

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { status: "", remarks: "", winnerName: "", winningBidAmount: "", lossReason: "" },
  });

  const selectedStatus = form.watch("status");

  async function handleSubmit(values: FormValues) {
    await onSubmit({
      status: values.status as TenderStatus,
      remarks: values.remarks || undefined,
      winnerName: values.winnerName || undefined,
      winningBidAmount: values.winningBidAmount ? Number(values.winningBidAmount) : undefined,
      lossReason: values.lossReason || undefined,
    });
    form.reset();
    setOpen(false);
  }

  if (allowedNext.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <ArrowRightCircle className="mr-2 h-4 w-4" /> Change status
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change tender status</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a status" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {allowedNext.map((status) => (
                        <SelectItem key={status} value={status}>
                          {TENDER_STATUS_LABELS[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedStatus === "WON" && (
              <>
                <FormField
                  control={form.control}
                  name="winnerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Winner</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Us, or the winning bidder's name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="winningBidAmount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Winning bid amount</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </>
            )}

            {selectedStatus === "LOST" && (
              <FormField
                control={form.control}
                name="lossReason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason lost</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="submit">Confirm</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
