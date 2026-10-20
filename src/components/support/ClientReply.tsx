"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/admin/ui/Button";
import { Textarea } from "@/components/admin/ui/Input";
import { replyAsClient } from "@/lib/portal/actions/support-actions";

export default function ClientReply({ ticketId, resolved }: { ticketId: string; resolved: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");

  return (
    <form
      className="space-y-3 border-t border-slate-100 pt-5"
      action={(fd) =>
        start(async () => {
          const r = await replyAsClient(ticketId, fd);
          if (r.ok) {
            toast.success("Reply sent.");
            setBody("");
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      {resolved && <p className="text-xs text-slate-500">This request is resolved. Replying opens it again.</p>}
      <Textarea name="body" value={body} onChange={(e) => setBody(e.target.value)} required maxLength={5000} placeholder="Write a reply…" />
      <Button type="submit" loading={pending}>
        <Send className="h-4 w-4" /> Send reply
      </Button>
    </form>
  );
}
