"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X, LogOut, User, LayoutDashboard, Receipt, LifeBuoy } from "lucide-react";
import { Toaster } from "sonner";
import { cn } from "@/lib/utils";
import { portalLogoutAction } from "@/lib/portal/actions/auth-actions";
import EdosLogoMark from "@/components/ui/EdosLogoMark";
import type { ClientPortalUserRow } from "@/types/database.types";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/portal", icon: LayoutDashboard },
  { label: "Invoices", href: "/portal/invoices", icon: Receipt },
  { label: "Support", href: "/portal/support", icon: LifeBuoy },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full w-64 flex-col bg-[#1A1733] text-slate-200">
      <div className="flex h-16 items-center gap-2 border-b border-white/10 px-5">
        <EdosLogoMark dark={false} />
        <span className="text-sm font-semibold text-white">Client Portal</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/portal" ? pathname === "/portal" : pathname.startsWith(item.href);
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
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export default function PortalShell({ portalUser, children }: { portalUser: ClientPortalUserRow; children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Toaster richColors position="top-right" />

      <div className="hidden lg:block">
        <Nav />
      </div>

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 lg:hidden" />
          <Dialog.Content className="fixed inset-y-0 left-0 z-50 lg:hidden">
            <Dialog.Title className="sr-only">Navigation</Dialog.Title>
            <Nav onNavigate={() => setMobileOpen(false)} />
            <Dialog.Close className="absolute right-3 top-3 text-white/70 hover:text-white">
              <X className="h-5 w-5" />
            </Dialog.Close>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-4 lg:px-8">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="text-slate-500 hover:text-slate-800 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>

          <div className="hidden text-sm text-slate-400 lg:block">EDOS Centre</div>

          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-2 text-sm text-slate-600 sm:flex">
              <User className="h-4 w-4" />
              <span>{portalUser.full_name ?? portalUser.email}</span>
            </div>
            <form action={portalLogoutAction}>
              <button
                type="submit"
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </form>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
