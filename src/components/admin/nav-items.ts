import type { LucideIcon } from "lucide-react";
import { LayoutDashboard, Globe, ScrollText, Users, Repeat, Receipt, MailCheck, Server, Bell, BarChart3, Search, UserCog, LifeBuoy, Settings } from "lucide-react";

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
  { label: "Billing automation", href: "/admin/billing-automation", icon: MailCheck },
  { label: "Hosting & Domains", href: "/admin/hosting", icon: Server },
  { label: "Reports", href: "/admin/reports", icon: BarChart3 },
  { label: "SEO", href: "/admin/seo", icon: Search },
  { label: "Notifications", href: "/admin/notifications", icon: Bell },
  { label: "Activity Logs", href: "/admin/activity-logs", icon: ScrollText },
  { label: "Admin Users", href: "/admin/admin-users", icon: UserCog, superAdminOnly: true },
];

/** Sections planned for later phases — shown so the platform's shape is visible, but not wired to real functionality yet. */
export const COMING_SOON_ITEMS: NavItem[] = [
  { label: "Support", href: "#", icon: LifeBuoy },
  { label: "Settings", href: "#", icon: Settings },
];
