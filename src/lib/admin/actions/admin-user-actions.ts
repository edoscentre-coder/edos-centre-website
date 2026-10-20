"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { logAudit } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";

async function requireSuperAdmin() {
  const admin = await requireAdmin();
  if (admin.role !== "super_admin") throw new Error("Only super admins can manage admin users.");
  return admin;
}

function generateTempPassword() {
  // Random, so never on a leaked-password list — must_change_password forces a real one on first login.
  return `${randomBytes(9).toString("base64url")}!1`;
}

async function assertNotLastSuperAdmin(excludingId: string, action: string) {
  const supabase = await createServiceClient();
  const { count } = await supabase
    .from("edoscentreadmin_admin_users")
    .select("*", { count: "exact", head: true })
    .eq("role", "super_admin")
    .eq("is_active", true)
    .neq("id", excludingId);
  if ((count ?? 0) === 0) throw new Error(`Cannot ${action} the last active super admin.`);
}

async function setWebsiteScope(adminUserId: string, role: string, websiteIds: string[]) {
  const supabase = await createServiceClient();
  await supabase.from("edoscentreadmin_admin_user_websites").delete().eq("admin_user_id", adminUserId);
  if (role !== "super_admin" && websiteIds.length > 0) {
    const { error } = await supabase
      .from("edoscentreadmin_admin_user_websites")
      .insert(websiteIds.map((website_id) => ({ admin_user_id: adminUserId, website_id })));
    if (error) throw new Error(error.message);
  }
}

const inviteSchema = z.object({
  email: z.string().email(),
  full_name: z.string().optional(),
  role: z.enum(["super_admin", "website_admin", "content_editor"]),
});

/**
 * auth.users is shared across every tenant app in this Supabase project. If the
 * email already has an account (from another app, or a previous invite here),
 * we grant EDOS admin access to that existing identity instead of creating a
 * duplicate — and never touch its existing password.
 */
export async function inviteAdminUser(formData: FormData) {
  const admin = await requireSuperAdmin();
  const parsed = inviteSchema.parse(Object.fromEntries(formData));
  const websiteIds = formData.getAll("website_ids").map(String).filter(Boolean);

  const supabase = await createServiceClient();
  const tempPassword = generateTempPassword();

  let userId: string;
  let isNewAccount = true;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: parsed.email,
    password: tempPassword,
    email_confirm: true,
  });

  if (createError) {
    if (!createError.message.toLowerCase().includes("already been registered")) {
      throw new Error(createError.message);
    }
    isNewAccount = false;
    const { data: list, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw new Error(listError.message);
    const existing = list.users.find((u) => u.email?.toLowerCase() === parsed.email.toLowerCase());
    if (!existing) throw new Error("Could not find the existing account for that email.");
    userId = existing.id;
  } else {
    userId = created.user.id;
  }

  const { error: upsertError } = await supabase.from("edoscentreadmin_admin_users").upsert(
    {
      id: userId,
      email: parsed.email,
      full_name: parsed.full_name || null,
      role: parsed.role,
      is_active: true,
      must_change_password: isNewAccount,
    },
    { onConflict: "id" },
  );
  if (upsertError) throw new Error(upsertError.message);

  await setWebsiteScope(userId, parsed.role, websiteIds);

  await logAudit({
    actorId: admin.id,
    action: isNewAccount ? "admin_user_invited" : "admin_user_granted_access",
    metadata: { email: parsed.email, role: parsed.role },
  });
  revalidatePath("/admin/settings/admin-users");

  return { email: parsed.email, role: parsed.role, tempPassword: isNewAccount ? tempPassword : null, isNewAccount };
}

const updateSchema = z.object({
  role: z.enum(["super_admin", "website_admin", "content_editor"]),
  full_name: z.string().optional(),
});

export async function updateAdminUser(id: string, formData: FormData) {
  const admin = await requireSuperAdmin();
  const parsed = updateSchema.parse(Object.fromEntries(formData));
  const websiteIds = formData.getAll("website_ids").map(String).filter(Boolean);

  const supabase = await createServiceClient();

  if (parsed.role !== "super_admin") {
    const { data: target } = await supabase.from("edoscentreadmin_admin_users").select("role").eq("id", id).single();
    if (target?.role === "super_admin") await assertNotLastSuperAdmin(id, "demote");
  }

  const { error } = await supabase
    .from("edoscentreadmin_admin_users")
    .update({ role: parsed.role, full_name: parsed.full_name || null })
    .eq("id", id);
  if (error) throw new Error(error.message);

  await setWebsiteScope(id, parsed.role, websiteIds);

  await logAudit({ actorId: admin.id, action: "admin_user_updated", metadata: { id, role: parsed.role } });
  revalidatePath("/admin/settings/admin-users");
}

export async function setAdminUserActive(id: string, isActive: boolean) {
  const admin = await requireSuperAdmin();
  if (id === admin.id && !isActive) throw new Error("You cannot deactivate your own account.");
  if (!isActive) await assertNotLastSuperAdmin(id, "deactivate");

  const supabase = await createServiceClient();
  const { error } = await supabase.from("edoscentreadmin_admin_users").update({ is_active: isActive }).eq("id", id);
  if (error) throw new Error(error.message);

  await logAudit({ actorId: admin.id, action: isActive ? "admin_user_activated" : "admin_user_deactivated", metadata: { id } });
  revalidatePath("/admin/settings/admin-users");
}

export async function resetAdminUserPassword(id: string) {
  const admin = await requireSuperAdmin();
  const supabase = await createServiceClient();
  const tempPassword = generateTempPassword();

  const { error: pwError } = await supabase.auth.admin.updateUserById(id, { password: tempPassword });
  if (pwError) throw new Error(pwError.message);

  const { error } = await supabase.from("edoscentreadmin_admin_users").update({ must_change_password: true }).eq("id", id);
  if (error) throw new Error(error.message);

  await logAudit({ actorId: admin.id, action: "admin_user_password_reset", metadata: { id } });
  revalidatePath("/admin/settings/admin-users");
  return { tempPassword };
}
