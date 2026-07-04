"use client";

import { LABOR_CATEGORIES } from "@bmp/types";
import {
  Button,
  Card,
  CardContent,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useToast,
} from "@bmp/ui";
import { Plus } from "lucide-react";
import { useState } from "react";

import { useAddLaborEntry, useLaborEntries } from "@/hooks/use-projects";

function AddLaborEntryDialog({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const addEntry = useAddLaborEntry(projectId);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof LABOR_CATEGORIES)[number]>("SKILLED");
  const [description, setDescription] = useState("");
  const [workerCount, setWorkerCount] = useState("");
  const [units, setUnits] = useState("");
  const [ratePerUnit, setRatePerUnit] = useState("");

  const amount =
    Number(workerCount) > 0 && Number(units) > 0 && Number(ratePerUnit) >= 0
      ? Number(workerCount) * Number(units) * Number(ratePerUnit)
      : 0;

  async function handleSubmit() {
    if (!description.trim() || !workerCount || !units || !ratePerUnit) {
      toast({ variant: "destructive", title: "All fields are required" });
      return;
    }
    try {
      await addEntry.mutateAsync({
        category,
        description: description.trim(),
        workerCount: Number(workerCount),
        units: Number(units),
        ratePerUnit: Number(ratePerUnit),
      });
      toast({ title: "Labor entry recorded" });
      setOpen(false);
      setDescription("");
      setWorkerCount("");
      setUnits("");
      setRatePerUnit("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not record labor entry",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" /> Add entry
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record labor entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={category} onValueChange={(v) => setCategory(v as (typeof LABOR_CATEGORIES)[number])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LABOR_CATEGORIES.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Description (e.g. Masons)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="number"
              placeholder="Worker count"
              value={workerCount}
              onChange={(e) => setWorkerCount(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Units (e.g. days)"
              value={units}
              onChange={(e) => setUnits(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Rate/unit"
              value={ratePerUnit}
              onChange={(e) => setRatePerUnit(e.target.value)}
            />
          </div>
          <p className="text-sm text-muted-foreground">Amount: {amount.toLocaleString()}</p>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={addEntry.isPending}>
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LaborEntriesTab({ projectId }: { projectId: string }) {
  const entriesQuery = useLaborEntries(projectId);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex justify-end">
          <AddLaborEntryDialog projectId={projectId} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Workers</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Rate</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(entriesQuery.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No labor entries recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              (entriesQuery.data ?? []).map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.category}</TableCell>
                  <TableCell>{entry.description}</TableCell>
                  <TableCell className="text-right">{entry.workerCount}</TableCell>
                  <TableCell className="text-right">{entry.units}</TableCell>
                  <TableCell className="text-right">{entry.ratePerUnit.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{entry.amount.toLocaleString()}</TableCell>
                  <TableCell>{new Date(entry.entryDate).toLocaleDateString()}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
