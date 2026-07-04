"use client";

import { MILESTONE_STATUSES, type ProjectDto, type MilestoneStatus } from "@bmp/types";
import {
  Badge,
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
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { useAddMilestone, useDeleteMilestone, useUpdateMilestone } from "@/hooks/use-projects";

const STATUS_VARIANT: Record<MilestoneStatus, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  IN_PROGRESS: "secondary",
  COMPLETED: "default",
  DELAYED: "destructive",
};

function AddMilestoneDialog({ projectId }: { projectId: string }) {
  const { toast } = useToast();
  const addMilestone = useAddMilestone(projectId);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [plannedDate, setPlannedDate] = useState("");
  const [weightPercent, setWeightPercent] = useState("");

  async function handleSubmit() {
    if (!title.trim()) {
      toast({ variant: "destructive", title: "Title is required" });
      return;
    }
    try {
      await addMilestone.mutateAsync({
        title: title.trim(),
        plannedDate: plannedDate || undefined,
        weightPercent: weightPercent ? Number(weightPercent) : undefined,
      });
      toast({ title: "Milestone added" });
      setOpen(false);
      setTitle("");
      setPlannedDate("");
      setWeightPercent("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not add milestone",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Plus className="mr-2 h-4 w-4" /> Add milestone
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add milestone</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} />
          <Input
            type="number"
            placeholder="Weight % (for progress calc)"
            value={weightPercent}
            onChange={(e) => setWeightPercent(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={addMilestone.isPending}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MilestonesTab({ project }: { project: ProjectDto }) {
  const { toast } = useToast();
  const updateMilestone = useUpdateMilestone(project.id);
  const deleteMilestone = useDeleteMilestone(project.id);

  async function handleStatusChange(milestoneId: string, status: MilestoneStatus) {
    try {
      await updateMilestone.mutateAsync({ milestoneId, input: { status } });
      toast({ title: "Milestone updated" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not update milestone",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex justify-end">
          <AddMilestoneDialog projectId={project.id} />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Planned Date</TableHead>
              <TableHead>Weight %</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {project.milestones.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No milestones yet.
                </TableCell>
              </TableRow>
            ) : (
              project.milestones.map((milestone) => (
                <TableRow key={milestone.id}>
                  <TableCell>{milestone.title}</TableCell>
                  <TableCell>
                    {milestone.plannedDate ? new Date(milestone.plannedDate).toLocaleDateString() : "-"}
                  </TableCell>
                  <TableCell>{milestone.weightPercent}%</TableCell>
                  <TableCell>
                    <Select
                      value={milestone.status}
                      onValueChange={(v) => handleStatusChange(milestone.id, v as MilestoneStatus)}
                    >
                      <SelectTrigger className="h-8 w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MILESTONE_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            <Badge variant={STATUS_VARIANT[status]} className="mr-1">
                              {status}
                            </Badge>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteMilestone.mutate(milestone.id)}
                      aria-label="Delete milestone"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
