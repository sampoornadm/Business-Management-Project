"use client";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  useToast,
} from "@bmp/ui";
import { LogOut, Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";

import { useLogout } from "@/hooks/use-auth";
import { useSwitchBusiness } from "@/hooks/use-switch-business";
import { useAuthStore } from "@/lib/auth-store";
import { useBreadcrumbStore } from "@/lib/breadcrumb-store";

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
  const labels = useBreadcrumbStore((state) => state.labels);
  const segments = pathname.split("/").filter((segment) => segment && segment !== "dashboard");

  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      <Link href="/dashboard" className="hover:text-foreground">
        Home
      </Link>
      {segments.map((segment, index, arr) => {
        const href = `/${segments.slice(0, index + 1).join("/")}`;
        const label = labels[segment] ?? toTitleCase(segment);
        const isLast = index === arr.length - 1;

        return (
          <Fragment key={segment}>
            <span>/</span>
            {isLast ? (
              <span className="font-medium text-foreground">{label}</span>
            ) : (
              <Link href={href} className="hover:text-foreground">
                {label}
              </Link>
            )}
          </Fragment>
        );
      })}
    </nav>
  );
}

export function Topbar() {
  const user = useAuthStore((state) => state.user);
  const activeBusinessId = useAuthStore((state) => state.activeBusinessId);
  const availableBusinesses = useAuthStore((state) => state.availableBusinesses);
  const logout = useLogout();
  const switchBusiness = useSwitchBusiness();
  const { toast } = useToast();

  const initials = user ? `${user.firstName[0] ?? ""}${user.lastName[0] ?? ""}`.toUpperCase() : "";

  async function handleSwitchBusiness(businessId: string) {
    try {
      await switchBusiness.mutateAsync(businessId);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Failed to switch business",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    }
  }

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-4">
      <Breadcrumbs />
      <div className="flex items-center gap-2">
        <TopbarSearch />
        {availableBusinesses.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                {availableBusinesses.find((b) => b.businessId === activeBusinessId)?.businessName ??
                  "Select business"}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Switch business</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {availableBusinesses.map((business) => (
                <DropdownMenuItem
                  key={business.businessId}
                  disabled={business.businessId === activeBusinessId || switchBusiness.isPending}
                  onClick={() => handleSwitchBusiness(business.businessId)}
                >
                  {business.businessName}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
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
