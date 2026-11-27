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
  Package,
  Receipt,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Swords,
  Truck,
  Users2,
} from "lucide-react";
import type { ComponentType } from "react";

export interface NavItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  permission?: PermissionKey;
  /** Sidebar group heading; items of one section must sit next to each other in NAV_ITEMS. */
  section?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Tenders", href: "/tenders", icon: FileText, permission: "tenders:read", section: "Tendering" },
  { label: "Organizations", href: "/organizations", icon: Building2, permission: "organizations:read", section: "Tendering" },
  { label: "Competitors", href: "/competitors", icon: Swords, permission: "competitors:read", section: "Tendering" },
  { label: "Vendors", href: "/vendors", icon: Truck, permission: "vendors:read", section: "Procurement" },
  { label: "RFQs", href: "/rfqs", icon: FileSpreadsheet, permission: "rfq:read", section: "Procurement" },
  { label: "Items", href: "/items", icon: Package, permission: "rfq:read", section: "Procurement" },
  { label: "Vendor POs", href: "/purchase-orders", icon: ShoppingCart, permission: "purchase_orders:read", section: "Procurement" },
  { label: "Projects", href: "/projects", icon: HardHat, permission: "projects:read", section: "Execution" },
  { label: "Finance", href: "/finance", icon: Landmark, permission: "finance:read", section: "Money" },
  { label: "Bills", href: "/bills", icon: Receipt, permission: "bills:read", section: "Money" },
  { label: "Reports", href: "/reports", icon: BarChart3, permission: "reports:read", section: "Money" },
  { label: "Users", href: "/users", icon: Users2, permission: "users:read", section: "Admin" },
  { label: "Roles & permissions", href: "/settings/roles", icon: ShieldCheck, permission: "roles:read", section: "Admin" },
  { label: "Audit log", href: "/settings/audit-log", icon: FileClock, permission: "audit:read", section: "Admin" },
  { label: "Businesses", href: "/businesses", icon: Briefcase, permission: "businesses:read", section: "Admin" },
  // The page has existed since Phase 1 but nothing ever linked to it — reachable only by typing
  // the URL, which also made the classifier rebuild button undiscoverable.
  { label: "Settings", href: "/settings", icon: Settings, permission: "settings:read", section: "Admin" },
];
