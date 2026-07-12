"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, type PropsWithChildren } from "react";

import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useAuthStore } from "@/lib/auth-store";
import { applyThemeColorVars } from "@/lib/theme-colors";

export default function DashboardLayout({ children }: PropsWithChildren) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isInitializing = useAuthStore((state) => state.isInitializing);
  const activeBusinessId = useAuthStore((state) => state.activeBusinessId);
  const availableBusinesses = useAuthStore((state) => state.availableBusinesses);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (!isInitializing && !user) {
      router.replace("/login");
    }
  }, [isInitializing, user, router]);

  useEffect(() => {
    const active = availableBusinesses.find((b) => b.businessId === activeBusinessId);
    if (!active) return;
    applyThemeColorVars(active.themeColor, resolvedTheme === "dark" ? "dark" : "light");
  }, [activeBusinessId, availableBusinesses, resolvedTheme]);

  if (isInitializing) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto bg-muted/20 p-6">{children}</main>
      </div>
    </div>
  );
}
