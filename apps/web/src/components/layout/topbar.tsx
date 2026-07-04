"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bmp/ui";
import { LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import { useLogout } from "@/hooks/use-auth";
import { useAuthStore } from "@/lib/auth-store";

import { NotificationBell } from "./notification-bell";
import { ThemeToggle } from "./theme-toggle";
import { TopbarSearch } from "./topbar-search";

function toTitleCase(segment: string): string {
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function Breadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      <Link href="/dashboard" className="hover:text-foreground">
        Home
      </Link>
      {segments
        .filter((segment) => segment !== "dashboard")
        .map((segment, index, arr) => (
          <Fragment key={segment}>
            <span>/</span>
            <span className={index === arr.length - 1 ? "font-medium text-foreground" : ""}>
              {toTitleCase(segment)}
            </span>
          </Fragment>
        ))}
    </nav>
  );
}

export function Topbar() {
  const user = useAuthStore((state) => state.user);
  const logout = useLogout();

  const initials = user ? `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase() : "";

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <Breadcrumbs />
      <div className="flex items-center gap-2">
        <TopbarSearch />
        <NotificationBell />
        <ThemeToggle />
        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar className="h-8 w-8">
              <AvatarImage src={user?.avatar?.thumbnailUrl ?? undefined} alt={user?.firstName} />
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {user?.firstName} {user?.lastName}
              <div className="text-xs font-normal text-muted-foreground">{user?.role.name}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/profile">
                <UserRound className="mr-2 h-4 w-4" /> Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/sessions">
                <Settings className="mr-2 h-4 w-4" /> Sessions
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logout.mutate()}>
              <LogOut className="mr-2 h-4 w-4" /> Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
