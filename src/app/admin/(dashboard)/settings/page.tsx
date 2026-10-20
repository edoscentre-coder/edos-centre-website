import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin/auth";
import MyAccountPanel from "@/components/admin/settings/MyAccountPanel";

export const metadata = { title: "My account — Settings — EDOS Control Centre" };

export default async function MyAccountPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  return (
    <MyAccountPanel
      admin={{
        email: admin.email,
        fullName: admin.full_name,
        role: admin.role,
        lastLoginAt: admin.last_login_at,
        createdAt: admin.created_at,
      }}
    />
  );
}
