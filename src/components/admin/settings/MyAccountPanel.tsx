"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { Input, Label } from "@/components/admin/ui/Input";
import ChangePasswordForm from "@/components/admin/ChangePasswordForm";
import { updateMyName } from "@/lib/admin/actions/settings-actions";

const when = (d: string | null) =>
  d
    ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";

export default function MyAccountPanel({
  admin,
}: {
  admin: { email: string; fullName: string | null; role: string; lastLoginAt: string | null; createdAt: string };
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [name, setName] = useState(admin.fullName ?? "");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-900">Profile</h2>
        </CardHeader>
        <CardBody>
          <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium text-slate-900">{admin.email}</dd>
            <dt className="text-slate-500">Role</dt>
            <dd className="font-medium capitalize text-slate-900">{admin.role.replace(/_/g, " ")}</dd>
            <dt className="text-slate-500">Last sign-in</dt>
            <dd className="text-slate-700">{when(admin.lastLoginAt)}</dd>
            <dt className="text-slate-500">Account created</dt>
            <dd className="text-slate-700">{when(admin.createdAt)}</dd>
          </dl>
          <form
            className="space-y-3"
            action={(fd) =>
              start(async () => {
                const r = await updateMyName(fd);
                if (r.ok) {
                  toast.success("Name saved.");
                  router.refresh();
                } else toast.error(r.error);
              })
            }
          >
            <div>
              <Label htmlFor="full_name">Your name</Label>
              <Input
                id="full_name"
                name="full_name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Shown in the activity log"
              />
            </div>
            <Button type="submit" loading={pending}>
              Save name
            </Button>
          </form>
          <p className="mt-4 text-xs text-slate-500">A sign-in email is changed by a super admin under Admin users.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-900">Change password</h2>
        </CardHeader>
        <CardBody>
          <ChangePasswordForm onDone={() => toast.success("Password changed.")} />
        </CardBody>
      </Card>
    </div>
  );
}
