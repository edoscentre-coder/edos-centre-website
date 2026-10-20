import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin/auth";
import SettingsTabs from "@/components/admin/settings/SettingsTabs";

/**
 * One place for admin-wide settings. Each tab is its own route, so a link can
 * open a tab directly and the old Billing automation and Admin users URLs
 * redirect into theirs (next.config.ts).
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">Your account, EDOS Centre&apos;s details, billing and email, and the state of the system.</p>
      </div>
      <SettingsTabs isSuperAdmin={admin.role === "super_admin"} />
      <div>{children}</div>
    </div>
  );
}
