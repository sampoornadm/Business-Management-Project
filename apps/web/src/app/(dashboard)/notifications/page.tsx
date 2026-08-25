"use client";

import {
  Button,
  Card,
  CardContent,
  EmptyState,
  formatDateTime,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  useToast,
} from "@bmp/ui";
import { Bell } from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useState } from "react";

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/hooks/use-notifications";
import { useAuthStore } from "@/lib/auth-store";
import { notificationHref } from "@/lib/notification-href";
import { THEME_COLORS } from "@/lib/theme-colors";

export default function NotificationsPage() {
  const { toast } = useToast();
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  const availableBusinesses = useAuthStore((state) => state.availableBusinesses);
  const businessById = new Map(availableBusinesses.map((b) => [b.businessId, b]));
  const canSeeMultipleBusinesses = availableBusinesses.length > 1;

  const [page, setPage] = useState(1);
  const [allBusinesses, setAllBusinesses] = useState(false);
  const notificationsQuery = useNotifications({ page, pageSize: 20, allBusinesses });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  async function handleMarkAllRead() {
    await markAllRead.mutateAsync(allBusinesses);
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

      {canSeeMultipleBusinesses && (
        <Tabs
          value={allBusinesses ? "all" : "active"}
          onValueChange={(v) => {
            setAllBusinesses(v === "all");
            setPage(1);
          }}
        >
          <TabsList>
            <TabsTrigger value="active">This business</TabsTrigger>
            <TabsTrigger value="all">All my businesses</TabsTrigger>
          </TabsList>
        </Tabs>
      )}

      {notificationsQuery.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <div className="space-y-2">
          {(notificationsQuery.data?.items ?? []).map((notification) => {
            const href = notificationHref(notification.entityType, notification.entityId);
            const business = businessById.get(notification.businessId);
            const showBusinessTag = allBusinesses && canSeeMultipleBusinesses && business;
            const body = (
              <>
                <div className="flex items-center gap-2">
                  {!notification.isRead && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  )}
                  <p className="text-sm font-medium">{notification.title}</p>
                  {showBusinessTag && (
                    <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: `hsl(${THEME_COLORS[business.themeColor][mode].primary})` }}
                        aria-hidden
                      />
                      {business.businessCode}
                    </span>
                  )}
                </div>
                {notification.body && (
                  <p className="text-sm text-muted-foreground">{notification.body}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDateTime(notification.createdAt)}
                </p>
              </>
            );
            const onOpen = () => {
              if (!notification.isRead) markRead.mutate(notification.id);
            };

            return (
              <Card key={notification.id} className={notification.isRead ? undefined : "bg-accent/50"}>
                <CardContent className="flex items-start justify-between gap-4 pt-4">
                  {href ? (
                    <Link href={href} className="min-w-0 flex-1 hover:underline" onClick={onOpen}>
                      {body}
                    </Link>
                  ) : (
                    <div className="min-w-0 flex-1">{body}</div>
                  )}
                  {!notification.isRead && (
                    <Button size="sm" variant="ghost" onClick={onOpen}>
                      Mark read
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
          {notificationsQuery.data?.items.length === 0 && (
            <EmptyState
              icon={Bell}
              title="No notifications yet"
              description="Deadline reminders and other alerts that concern you will show up here."
            />
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
