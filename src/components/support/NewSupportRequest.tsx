"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/admin/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/admin/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/admin/ui/Input";
import { openSupportRequest } from "@/lib/portal/actions/support-actions";

export default function NewSupportRequest({ websites }: { websites: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> New request
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h2 className="font-medium text-slate-900">New request</h2>
      </CardHeader>
      <CardBody>
        <form
          className="space-y-4"
          action={(fd) =>
            start(async () => {
              const r = await openSupportRequest(fd);
              if (r.ok) {
                toast.success("Request sent — we'll reply here and by email.");
                router.push(r.id ? `/portal/support/${r.id}` : "/portal/support");
              } else toast.error(r.error);
            })
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" name="subject" required maxLength={200} placeholder="e.g. Update the prices on the services page" />
            </div>
            <div>
              <Label htmlFor="category">What is it about?</Label>
              <Select id="category" name="category" defaultValue="change_request">
                <option value="change_request">A change to my website</option>
                <option value="bug">Something isn&apos;t working</option>
                <option value="billing">Billing or an invoice</option>
                <option value="other">Something else</option>
              </Select>
            </div>
            {websites.length > 0 && (
              <div>
                <Label htmlFor="website_id">Website</Label>
                <Select id="website_id" name="website_id" defaultValue={websites.length === 1 ? websites[0].id : ""}>
                  <option value="">Not about a specific website</option>
                  {websites.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <div className="md:col-span-2">
              <Label htmlFor="body">Details</Label>
              <Textarea id="body" name="body" required maxLength={5000} placeholder="What do you need? Include links or page names if it helps." />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="urgent" className="h-4 w-4 rounded border-slate-300" /> This is urgent — my website or business is affected
          </label>
          <div className="flex gap-2">
            <Button type="submit" loading={pending}>
              Send request
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
