"use client";

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

import { useAddMaterialUsage, useMaterialUsages } from "@/hooks/use-projects";

function AddMaterialUsageDialog({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const addUsage = useAddMaterialUsage(projectId);
  const [open, setOpen] = useState(false);
  const [materialName, setMaterialName] = useState("");
  const [unit, setUnit] = useState("");
  const [quantityUsed, setQuantityUsed] = useState("");

  async function handleSubmit() {
    if (!materialName.trim() || !quantityUsed.trim()) {
      toast({ variant: "destructive", title: "Material name and quantity are required" });
      return;
    }
    try {
      await addUsage.mutateAsync({
        materialName: materialName.trim(),
        unit: unit.trim() || undefined,
        quantityUsed: Number(quantityUsed),
      });
      toast({ title: "Material usage recorded" });
      setOpen(false);
      setMaterialName("");
      setUnit("");
      setQuantityUsed("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not record material usage",
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
          <DialogTitle>Record material usage</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Material name"
            value={materialName}
            onChange={(e) => setMaterialName(e.target.value)}
          />
          <Input placeholder="Unit (bag, cum, kg...)" value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Input
            type="number"
            placeholder="Quantity used"
            value={quantityUsed}
            onChange={(e) => setQuantityUsed(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={addUsage.isPending}>
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MaterialUsageTab({ projectId }: { projectId: string }) {
  const usagesQuery = useMaterialUsages(projectId);

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex justify-end">
          <AddMaterialUsageDialog projectId={projectId} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Material</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Recorded By</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(usagesQuery.data ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No material usage recorded yet.
                </TableCell>
              </TableRow>
            ) : (
              (usagesQuery.data ?? []).map((usage) => (
                <TableRow key={usage.id}>
                  <TableCell>{usage.materialName}</TableCell>
                  <TableCell>{usage.unit ?? "-"}</TableCell>
                  <TableCell className="text-right">{usage.quantityUsed}</TableCell>
                  <TableCell>{new Date(usage.usageDate).toLocaleDateString()}</TableCell>
                  <TableCell>
                    {usage.recordedBy.firstName} {usage.recordedBy.lastName}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
