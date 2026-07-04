"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  useToast,
} from "@bmp/ui";
import { Building } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCreateProjectFromTender } from "@/hooks/use-projects";

export function ConvertToProjectDialog({ tenderId }: { tenderId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const createProject = useCreateProjectFromTender();
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));

  async function handleSubmit() {
    try {
      const project = await createProject.mutateAsync({ tenderId, startDate });
      toast({ title: "Project created" });
      setOpen(false);
      router.push(`/projects/${project.id}`);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not create project",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Building className="mr-2 h-4 w-4" /> Convert to Project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert to Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium">Start date</label>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={createProject.isPending}>
            {createProject.isPending ? "Creating…" : "Create Project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
