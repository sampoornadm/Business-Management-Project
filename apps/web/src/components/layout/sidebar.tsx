"use client";

import { Button, cn } from "@bmp/ui";
import { ChevronsLeft, ChevronsRight, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

import { NAV_ITEMS } from "./nav-items";

export interface SidebarProps {
  /** Whether the mobile drawer is open — ignored at the `md` breakpoint and up. */
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
}

export function Sidebar({ mobileOpen, onMobileOpenChange }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const roleName = useAuthStore((state) => state.user?.role.name);

  const items = NAV_ITEMS.filter((item) => !item.permission || hasPermission(roleName, item.permission));

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={() => onMobileOpenChange(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col border-r bg-card transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          "md:static md:translate-x-0 md:transition-[width]",
          collapsed ? "md:w-16" : "md:w-64",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          {!collapsed && (
            <span className="truncate font-mono text-sm font-semibold tracking-wide text-foreground">
              BM<span className="text-primary">·</span>P
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto hidden md:inline-flex"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto md:hidden"
            onClick={() => onMobileOpenChange(false)}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md border-l-2 py-2 pl-[10px] pr-3 text-sm font-medium transition-colors",
                  isActive
                    ? "border-l-primary bg-primary/10 text-primary"
                    : "border-l-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
                title={collapsed ? item.label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {(!collapsed || mobileOpen) && <span className="truncate md:inline">{item.label}</span>}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
