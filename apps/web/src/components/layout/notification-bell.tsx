"use client";

import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  formatDateTime,
} from "@bmp/ui";
import { Bell, BellOff } from "lucide-react";
import Link from "next/link";

import {
  useMarkNotificationRead,
  useNotifications,
  useUnreadNotificationCount,
} from "@/hooks/use-notifications";
import { notificationHref } from "@/lib/notification-href";

// The bell only ever shows unread items for the business the user is currently in — it answers
// "what's new right now", not "what happened". Full history (read + unread, every business the
// user can see) lives on /notifications.
export function NotificationBell() {
  const unreadCountQuery = useUnreadNotificationCount();
  const notificationsQuery = useNotifications({ pageSize: 10, isRead: false });
  const markRead = useMarkNotificationRead();

  const unreadCount = unreadCountQuery.data ?? 0;
  const notifications = notificationsQuery.data?.items ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              variant="destructive"
              className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full p-0 text-[10px]"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
            <BellOff className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">You&apos;re all caught up.</p>
            <Link href="/notifications" className="text-xs font-medium text-primary hover:underline">
              View all past notifications
            </Link>
          </div>
        ) : (
          notifications.map((notification) => {
            const href = notificationHref(notification.entityType, notification.entityId);
            const content = (
              <>
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  {notification.title}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(notification.createdAt)}
                </span>
              </>
            );
            const onClick = () => markRead.mutate(notification.id);

            return href ? (
              <DropdownMenuItem key={notification.id} asChild>
                <Link href={href} className="flex flex-col items-start gap-0.5" onClick={onClick}>
                  {content}
                </Link>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem key={notification.id} className="flex flex-col items-start gap-0.5" onClick={onClick}>
                {content}
              </DropdownMenuItem>
            );
          })
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications" className="justify-center text-sm font-medium">
            View all past notifications
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
