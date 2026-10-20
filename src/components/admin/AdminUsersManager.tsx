"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil, KeyRound, UserCheck, UserX, Copy } from "lucide-react";
import { Card } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { StatusBadge } from "@/components/admin/ui/Badge";
import { Input, Label, Select } from "@/components/admin/ui/Input";
import { Checkbox } from "@/components/admin/ui/Checkbox";
import { Drawer, ConfirmDialog } from "@/components/admin/ui/Drawer";
import { inviteAdminUser, updateAdminUser, setAdminUserActive, resetAdminUserPassword } from "@/lib/admin/actions/admin-user-actions";
import { formatDate } from "@/lib/utils";
import type { Database } from "@/types/database.types";
import type { AdminUserWithWebsites } from "@/lib/admin/queries";

type Website = Database["public"]["Tables"]["edoscentreadmin_websites"]["Row"];

const ROLES = [
  { value: "super_admin", label: "Super Admin" },
  { value: "website_admin", label: "Website Admin" },
  { value: "content_editor", label: "Content Editor" },
];

function RoleFields({ editing, websites }: { editing: AdminUserWithWebsites | null; websites: Website[] }) {
  const [role, setRole] = useState(editing?.role ?? "content_editor");
  const scopedIds = new Set((editing?.edoscentreadmin_admin_user_websites ?? []).map((w) => w.website_id));

  return (
    <>
      <div>
        <Label htmlFor="role">Role</Label>
        <Select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
      </div>
      {role !== "super_admin" && (
        <div>
          <Label>Websites this admin can access</Label>
          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            {websites.map((w) => (
              <Checkbox
                key={w.id}
                id={`website-${w.id}`}
                name="website_ids"
                value={w.id}
                label={w.name}
                defaultChecked={scopedIds.has(w.id)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

export default function AdminUsersManager({
  adminUsers,
  websites,
  currentUserId,
}: {
  adminUsers: AdminUserWithWebsites[];
  websites: Website[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<AdminUserWithWebsites | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateTarget, setDeactivateTarget] = useState<AdminUserWithWebsites | null>(null);
  const [pending, setPending] = useState(false);
  const [credentialResult, setCredentialResult] = useState<{ email: string; tempPassword: string | null; isNewAccount: boolean } | null>(null);

  function websiteNames(user: AdminUserWithWebsites) {
    if (user.role === "super_admin") return "All websites";
    const ids = new Set(user.edoscentreadmin_admin_user_websites.map((w) => w.website_id));
    const names = websites.filter((w) => ids.has(w.id)).map((w) => w.name);
    return names.length > 0 ? names.join(", ") : "None assigned";
  }

  async function onInvite(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const result = await inviteAdminUser(new FormData(e.currentTarget));
      setInviteOpen(false);
      setCredentialResult(result);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to invite admin.");
    } finally {
      setPending(false);
    }
  }

  async function onEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setPending(true);
    try {
      await updateAdminUser(editing.id, new FormData(e.currentTarget));
      toast.success("Admin user updated.");
      setEditOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to update admin.");
    } finally {
      setPending(false);
    }
  }

  async function onToggleActive(user: AdminUserWithWebsites) {
    if (user.is_active) {
      setDeactivateTarget(user);
      return;
    }
    try {
      await setAdminUserActive(user.id, true);
      toast.success("Admin reactivated.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to reactivate admin.");
    }
  }

  async function onConfirmDeactivate() {
    if (!deactivateTarget) return;
    setPending(true);
    try {
      await setAdminUserActive(deactivateTarget.id, false);
      toast.success("Admin deactivated.");
      setDeactivateTarget(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to deactivate admin.");
    } finally {
      setPending(false);
    }
  }

  async function onResetPassword(user: AdminUserWithWebsites) {
    try {
      const result = await resetAdminUserPassword(user.id);
      setCredentialResult({ email: user.email, tempPassword: result.tempPassword, isNewAccount: true });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to reset password.");
    }
  }

  function copyPassword() {
    if (!credentialResult?.tempPassword) return;
    navigator.clipboard?.writeText(credentialResult.tempPassword).then(() => toast.success("Copied."));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Admin users</h2>
          <p className="mt-1 text-sm text-slate-500">Who can sign in to this Control Centre, and what they can touch.</p>
        </div>
        <Button onClick={() => setInviteOpen(true)}>
          <Plus className="h-4 w-4" /> Invite admin
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-5 py-3">Admin</th>
                <th className="px-5 py-3">Role</th>
                <th className="px-5 py-3">Access</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Last login</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {adminUsers.map((user) => (
                <tr key={user.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-slate-900">{user.full_name ?? user.email}</div>
                    <div className="text-xs text-slate-400">{user.email}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium capitalize text-slate-700">
                      {user.role.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{websiteNames(user)}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={user.is_active ? "active" : "suspended"} />
                  </td>
                  <td className="px-5 py-3 text-xs text-slate-400">{user.last_login_at ? formatDate(user.last_login_at) : "Never"}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => {
                          setEditing(user);
                          setEditOpen(true);
                        }}
                        title="Edit"
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => onResetPassword(user)} title="Reset password" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                        <KeyRound className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => onToggleActive(user)}
                        title={user.is_active ? "Deactivate" : "Activate"}
                        disabled={user.id === currentUserId && user.is_active}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30"
                      >
                        {user.is_active ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Drawer open={inviteOpen} onOpenChange={setInviteOpen} title="Invite admin" description="Grants access to this Control Centre. A temporary password is generated once — you'll need to hand it off yourself, no email is sent.">
        <form onSubmit={onInvite} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required />
          </div>
          <div>
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" name="full_name" />
          </div>
          <RoleFields editing={null} websites={websites} />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Invite
            </Button>
          </div>
        </form>
      </Drawer>

      <Drawer open={editOpen} onOpenChange={setEditOpen} title={editing ? `Edit ${editing.full_name ?? editing.email}` : "Edit admin"}>
        {editing && (
          <form onSubmit={onEdit} className="space-y-4">
            <div>
              <Label htmlFor="full_name">Full name</Label>
              <Input id="full_name" name="full_name" defaultValue={editing.full_name ?? ""} />
            </div>
            <RoleFields editing={editing} websites={websites} />
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                Save
              </Button>
            </div>
          </form>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!deactivateTarget}
        onOpenChange={(open) => !open && setDeactivateTarget(null)}
        title="Deactivate admin"
        description={deactivateTarget ? `${deactivateTarget.full_name ?? deactivateTarget.email} will no longer be able to sign in. This can be reversed at any time.` : ""}
        confirmLabel="Deactivate"
        danger
        loading={pending}
        onConfirm={onConfirmDeactivate}
      />

      <Drawer
        open={!!credentialResult}
        onOpenChange={(open) => !open && setCredentialResult(null)}
        title={credentialResult?.tempPassword ? "Temporary password" : "Access granted"}
        description={credentialResult?.tempPassword ? "Shown once — copy it now and hand it off securely. It cannot be retrieved again." : undefined}
      >
        {credentialResult && (
          <div className="space-y-4">
            <div>
              <Label>Email</Label>
              <Input readOnly value={credentialResult.email} />
            </div>
            {credentialResult.tempPassword ? (
              <div>
                <Label>Temporary password</Label>
                <div className="flex gap-2">
                  <Input readOnly value={credentialResult.tempPassword} className="font-mono" />
                  <Button type="button" variant="secondary" onClick={copyPassword}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-2 text-xs text-slate-400">They'll be forced to set a new password on first sign-in.</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                This email already had an account on this platform — no new password was generated. They can sign in with their existing password.
              </p>
            )}
            <div className="flex justify-end pt-2">
              <Button type="button" onClick={() => setCredentialResult(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
