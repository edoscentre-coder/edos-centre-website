"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, COMING_SOON_ITEMS } from "@/components/admin/nav-items";
import EdosLogoMark from "@/components/ui/EdosLogoMark";

export default function Sidebar({
  onNavigate,
  unreadCount = 0,
  isSuperAdmin = false,
}: {
  onNavigate?: () => void;
  unreadCount?: number;
  isSuperAdmin?: boolean;
}) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter((item) => !item.superAdminOnly || isSuperAdmin);

  return (
    <div className="flex h-full w-64 flex-col bg-[#1A1733] text-slate-200">
      <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
        <EdosLogoMark dark={false} />
        <span className="text-sm font-semibold text-white">Control Centre</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
              )}
            >
              <item.icon className="h-4.5 w-4.5" />
              <span className="flex-1">{item.label}</span>
              {item.href === "/admin/notifications" && unreadCount > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Link>
          );
        })}

        {COMING_SOON_ITEMS.length > 0 && (
          <div className="mt-6 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Coming soon</div>
        )}
        {COMING_SOON_ITEMS.map((item) => (
          <div
            key={item.label}
            className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500"
            title="Planned for a later phase"
          >
            <item.icon className="h-4.5 w-4.5" />
            {item.label}
          </div>
        ))}
      </nav>
    </div>
  );
}
