import type { PermissionKey } from "@bmp/types";
import {
  BarChart3,
  Briefcase,
  Building2,
  FileClock,
  FileSpreadsheet,
  FileText,
  HardHat,
  LayoutDashboard,
  Landmark,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users2,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  permission?: PermissionKey;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Tenders", href: "/tenders", icon: FileText, permission: "tenders:read" },
  { label: "Organizations", href: "/organizations", icon: Building2, permission: "organizations:read" },
  { label: "Vendors", href: "/vendors", icon: Truck, permission: "vendors:read" },
  { label: "RFQs", href: "/rfqs", icon: FileSpreadsheet, permission: "rfq:read" },
  {
    label: "Purchase Orders",
    href: "/purchase-orders",
    icon: ShoppingCart,
    permission: "purchase_orders:read",
  },
  { label: "Projects", href: "/projects", icon: HardHat, permission: "projects:read" },
  { label: "Finance", href: "/finance", icon: Landmark, permission: "finance:read" },
  { label: "Reports", href: "/reports", icon: BarChart3, permission: "reports:read" },
  { label: "Users", href: "/users", icon: Users2, permission: "users:read" },
  { label: "Roles & Permissions", href: "/settings/roles", icon: ShieldCheck, permission: "roles:read" },
  { label: "Audit Log", href: "/settings/audit-log", icon: FileClock, permission: "audit:read" },
  { label: "Businesses", href: "/businesses", icon: Briefcase, permission: "businesses:read" },
];
