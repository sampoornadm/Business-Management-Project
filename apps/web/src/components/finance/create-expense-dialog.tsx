"use client";

import { EXPENSE_CATEGORIES } from "@bmp/types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
import { Plus } from "lucide-react";
import { useState } from "react";

import { useCreateExpense } from "@/hooks/use-finance";

export function CreateExpenseDialog() {
  const { toast } = useToast();
  const createExpense = useCreateExpense();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof EXPENSE_CATEGORIES)[number]>("OTHER");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");

  async function handleSubmit() {
    if (!description.trim() || !amount) {
      toast({ variant: "destructive", title: "Description and amount are required" });
      return;
    }
    try {
      await createExpense.mutateAsync({ category, description: description.trim(), amount: Number(amount) });
      toast({ title: "Expense created" });
      setOpen(false);
      setDescription("");
      setAmount("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create expense",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" /> Add expense
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add expense</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={category} onValueChange={(v) => setCategory(v as (typeof EXPENSE_CATEGORIES)[number])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Input type="number" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={createExpense.isPending}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
