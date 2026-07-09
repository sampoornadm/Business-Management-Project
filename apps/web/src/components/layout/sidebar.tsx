"use client";

import { Button, cn } from "@bmp/ui";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { useAuthStore } from "@/lib/auth-store";
import { hasPermission } from "@/lib/permissions";

import { NAV_ITEMS } from "./nav-items";

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const roleName = useAuthStore((state) => state.user?.role.name);

  const items = NAV_ITEMS.filter((item) => !item.permission || hasPermission(roleName, item.permission));

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r bg-card transition-[width] duration-200",
        collapsed ? "w-16" : "w-64",
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
          className="ml-auto"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
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
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
