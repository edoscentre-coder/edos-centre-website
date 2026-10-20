"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { Button } from "@/components/admin/ui/Button";
import { sendTestEmail } from "@/lib/admin/actions/settings-actions";

/** Sends a real email to EDOS Centre's inbox or to you, to prove delivery end to end. */
export default function TestEmailButtons({ inbox, me }: { inbox: string; me: string }) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<"inbox" | "me" | null>(null);

  const send = (target: "inbox" | "me") => {
    setBusy(target);
    start(async () => {
      const r = await sendTestEmail(target);
      if (r.ok) toast.success(`Test sent to ${r.to} — check that inbox, and its spam folder.`);
      else toast.error(r.error);
      setBusy(null);
    });
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" variant="secondary" loading={busy === "inbox"} disabled={pending} onClick={() => send("inbox")}>
        <Mail className="h-3.5 w-3.5" /> Send test to {inbox}
      </Button>
      {me.toLowerCase() !== inbox.toLowerCase() && (
        <Button size="sm" variant="secondary" loading={busy === "me"} disabled={pending} onClick={() => send("me")}>
          <Mail className="h-3.5 w-3.5" /> Send test to me ({me})
        </Button>
      )}
    </div>
  );
}
