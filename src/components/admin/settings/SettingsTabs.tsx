"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "My account", href: "/admin/settings" },
  { label: "Business details", href: "/admin/settings/business" },
  { label: "Billing & email", href: "/admin/settings/billing" },
  { label: "System status", href: "/admin/settings/system" },
  { label: "Admin users", href: "/admin/settings/admin-users", superAdminOnly: true },
];

export default function SettingsTabs({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1" aria-label="Settings">
      {TABS.filter((t) => !t.superAdminOnly || isSuperAdmin).map((t) => {
        const active = t.href === "/admin/settings" ? pathname === t.href : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              active ? "border-[#1A1733] text-[#1A1733]" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
