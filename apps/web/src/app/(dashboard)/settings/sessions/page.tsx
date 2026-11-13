"use client";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  formatDateTime,
  PageHeader,
  Skeleton,
  useToast,
} from "@bmp/ui";
import { Laptop } from "lucide-react";

import { useLogoutAll, useRevokeSession, useSessions } from "@/hooks/use-auth";

export default function SessionsPage() {
  const sessionsQuery = useSessions();
  const revokeSession = useRevokeSession();
  const logoutAll = useLogoutAll();
  const { toast } = useToast();

  async function handleRevoke(id: string) {
    try {
      await revokeSession.mutateAsync(id);
      toast({ title: "Session revoked" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not revoke session",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader
        title="Active sessions"
        description="Devices currently signed in to your account."
        actions={
          <Button variant="outline" onClick={() => logoutAll.mutate()} disabled={logoutAll.isPending}>
            Log out everywhere
          </Button>
        }
      />

      {sessionsQuery.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <div className="space-y-3">
          {sessionsQuery.data?.map((session) => (
            <Card key={session.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Laptop className="h-4 w-4" />
                  {session.deviceInfo ?? "Unknown device"}
                  {session.isCurrent && <Badge variant="secondary">This device</Badge>}
                </CardTitle>
                {!session.isCurrent && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRevoke(session.id)}
                    disabled={revokeSession.isPending}
                  >
                    Revoke
                  </Button>
                )}
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {session.ipAddress ?? "Unknown IP"} · Signed in{" "}
                {formatDateTime(session.createdAt)}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
