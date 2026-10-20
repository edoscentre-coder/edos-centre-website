import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Globe, ScrollText, Users, Repeat, Receipt, Server, Bell, BarChart3, Search, LifeBuoy, Settings } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  superAdminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Websites", href: "/admin/websites", icon: Globe },
  { label: "Clients", href: "/admin/clients", icon: Users },
  { label: "Subscriptions", href: "/admin/subscriptions", icon: Repeat },
  { label: "Invoices", href: "/admin/invoices", icon: Receipt },
  { label: "Hosting & Domains", href: "/admin/hosting", icon: Server },
  { label: "Reports", href: "/admin/reports", icon: BarChart3 },
  { label: "SEO", href: "/admin/seo", icon: Search },
  { label: "Notifications", href: "/admin/notifications", icon: Bell },
  { label: "Activity Logs", href: "/admin/activity-logs", icon: ScrollText },
  { label: "Support", href: "/admin/support", icon: LifeBuoy },
  // Billing automation and Admin users live under Settings (tabs).
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

/** Sections planned for later phases, shown greyed out. Empty: Support and Settings are built. */
export const COMING_SOON_ITEMS: NavItem[] = [];
