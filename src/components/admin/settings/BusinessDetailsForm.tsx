"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardBody, CardHeader } from "@/components/admin/ui/Card";
import { Button } from "@/components/admin/ui/Button";
import { Input, Label } from "@/components/admin/ui/Input";
import { saveBusinessDetails } from "@/lib/admin/actions/settings-actions";

export default function BusinessDetailsForm({
  initial,
  pinEditable,
}: {
  initial: { contact_email: string; contact_phone: string; contact_location: string; kra_pin: string };
  pinEditable: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-slate-900">EDOS Centre&apos;s details</h2>
        <p className="text-sm text-slate-500">
          Printed on invoices and their PDFs, in client emails, and in the website footer. Payment details (paybill, bank) are under{" "}
          <Link href="/admin/settings/billing" className="font-medium text-slate-700 underline">
            Billing &amp; email
          </Link>
          .
        </p>
      </CardHeader>
      <CardBody>
        <form
          className="space-y-4"
          action={(fd) =>
            start(async () => {
              const r = await saveBusinessDetails(fd);
              if (r.ok) {
                toast.success("Business details saved.");
                router.refresh();
              } else toast.error(r.error);
            })
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="contact_email">Email</Label>
              <Input id="contact_email" name="contact_email" type="email" required defaultValue={initial.contact_email} />
            </div>
            <div>
              <Label htmlFor="contact_phone">Phone</Label>
              <Input id="contact_phone" name="contact_phone" required defaultValue={initial.contact_phone} />
            </div>
            <div>
              <Label htmlFor="contact_location">Location</Label>
              <Input id="contact_location" name="contact_location" required defaultValue={initial.contact_location} />
            </div>
            <div>
              <Label htmlFor="kra_pin">KRA PIN</Label>
              <Input id="kra_pin" name="kra_pin" defaultValue={initial.kra_pin} disabled={!pinEditable} />
              {!pinEditable && <p className="mt-1 text-xs text-amber-800">Saved once migration 026 has been run.</p>}
            </div>
          </div>
          <Button type="submit" loading={pending}>
            Save details
          </Button>
        </form>
        <p className="mt-4 text-xs text-slate-500">
          The website&apos;s title, description, social links and analytics stay under{" "}
          <Link href="/admin/websites/edos-centre/site-settings" className="underline">
            Websites → EDOS Centre → Site settings
          </Link>
          .
        </p>
      </CardBody>
    </Card>
  );
}
