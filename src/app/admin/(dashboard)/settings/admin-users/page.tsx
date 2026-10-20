import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/admin/auth";
import { getAdminUsers, getWebsites } from "@/lib/admin/queries";
import AdminUsersManager from "@/components/admin/AdminUsersManager";

export const metadata = { title: "Admin users — Settings — EDOS Control Centre" };

export default async function AdminUsersPage() {
  const admin = await getAdminUser();
  if (!admin) redirect("/admin/login");
  if (admin.role !== "super_admin") redirect("/admin");

  const [adminUsers, websites] = await Promise.all([getAdminUsers(), getWebsites()]);
  return <AdminUsersManager adminUsers={adminUsers} websites={websites} currentUserId={admin.id} />;
}
