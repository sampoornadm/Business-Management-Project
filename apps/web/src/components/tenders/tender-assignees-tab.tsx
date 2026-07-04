"use client";

import { TENDER_ASSIGNEE_ROLES, type TenderDto } from "@bmp/types";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "@bmp/ui";
import { UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";

import { useAddTenderAssignee, useRemoveTenderAssignee } from "@/hooks/use-tenders";
import { useUsers } from "@/hooks/use-users";
import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

export function TenderAssigneesTab({ tender }: { tender: TenderDto }) {
  const roleName = useAuthStore((state) => state.user?.role.name);
  const canAssign = hasPermission(roleName, "tenders:assign");
  const { toast } = useToast();

  const usersQuery = useUsers({ pageSize: 100, isActive: true });
  const addAssignee = useAddTenderAssignee(tender.id);
  const removeAssignee = useRemoveTenderAssignee(tender.id);

  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("OTHER");

  const assignedUserIds = new Set(tender.assignees.map((a) => a.user.id));
  const availableUsers = usersQuery.data?.items.filter((u) => !assignedUserIds.has(u.id)) ?? [];

  async function handleAdd() {
    if (!selectedUserId) return;
    try {
      await addAssignee.mutateAsync({ userId: selectedUserId, role: selectedRole as never });
      toast({ title: "Assignee added" });
      setSelectedUserId("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not add assignee",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  async function handleRemove(userId: string) {
    try {
      await removeAssignee.mutateAsync(userId);
      toast({ title: "Assignee removed" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not remove assignee",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="space-y-4">
      {canAssign && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="min-w-48">
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a user" />
              </SelectTrigger>
              <SelectContent>
                {availableUsers.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.firstName} {user.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <Select value={selectedRole} onValueChange={setSelectedRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TENDER_ASSIGNEE_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleAdd} disabled={!selectedUserId || addAssignee.isPending}>
            <UserPlus className="mr-2 h-4 w-4" /> Assign
          </Button>
        </div>
      )}

      {tender.assignees.length === 0 ? (
        <p className="text-sm text-muted-foreground">No one is assigned to this tender yet.</p>
      ) : (
        <div className="space-y-2">
          {tender.assignees.map((assignee) => (
            <div key={assignee.id} className="flex items-center justify-between rounded-md border p-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback>
                    {assignee.user.firstName[0]}
                    {assignee.user.lastName[0]}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">
                    {assignee.user.firstName} {assignee.user.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{assignee.user.email}</p>
                </div>
                <Badge variant="secondary">{assignee.role}</Badge>
              </div>
              {canAssign && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemove(assignee.user.id)}
                  disabled={removeAssignee.isPending}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
