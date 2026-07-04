"use client";

import { Button, Card, CardContent, Skeleton, useToast } from "@bmp/ui";
import { useState } from "react";

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/use-notifications";

export default function NotificationsPage() {
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const notificationsQuery = useNotifications({ page, pageSize: 20 });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  async function handleMarkAllRead() {
    await markAllRead.mutateAsync();
    toast({ title: "All notifications marked as read" });
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">Everything that&apos;s happened that concerns you.</p>
        </div>
        <Button variant="outline" onClick={handleMarkAllRead} disabled={markAllRead.isPending}>
          Mark all as read
        </Button>
      </div>

      {notificationsQuery.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-2">
          {(notificationsQuery.data?.items ?? []).map((notification) => (
            <Card key={notification.id} className={notification.isRead ? "opacity-60" : undefined}>
              <CardContent className="flex items-start justify-between gap-4 pt-4">
                <div>
                  <p className="text-sm font-medium">{notification.title}</p>
                  {notification.body && (
                    <p className="text-sm text-muted-foreground">{notification.body}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(notification.createdAt).toLocaleString()}
                  </p>
                </div>
                {!notification.isRead && (
                  <Button size="sm" variant="ghost" onClick={() => markRead.mutate(notification.id)}>
                    Mark read
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
          {notificationsQuery.data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">No notifications yet.</p>
          )}
        </div>
      )}

      {notificationsQuery.data && notificationsQuery.data.totalPages > 1 && (
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= notificationsQuery.data.totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
