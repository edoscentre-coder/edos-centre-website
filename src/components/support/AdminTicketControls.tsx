"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/admin/ui/Button";
import { Card, CardBody } from "@/components/admin/ui/Card";
import { Label, Select, Textarea } from "@/components/admin/ui/Input";
import { replyToTicket, updateTicketMeta } from "@/lib/admin/actions/support-actions";

/**
 * The admin's side of a request: the reply box (or an internal note), and the
 * status and priority. One component in two places on the page (`part`).
 */
export default function AdminTicketControls({
  ticketId,
  status,
  priority,
  part,
}: {
  ticketId: string;
  status: string;
  priority: string;
  part: "reply" | "meta";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [after, setAfter] = useState("waiting_on_client");

  if (part === "meta") {
    const change = (patch: { status?: string; priority?: string }, ok: string) =>
      start(async () => {
        const r = await updateTicketMeta(ticketId, patch);
        if (r.ok) {
          toast.success(ok);
          router.refresh();
        } else toast.error(r.error);
      });
    return (
      <Card>
        <CardBody className="space-y-3">
          <div>
            <Label htmlFor="ticket_status">Status</Label>
            <Select
              id="ticket_status"
              value={status}
              disabled={pending}
              onChange={(e) =>
                change({ status: e.target.value }, e.target.value === "resolved" ? "Resolved — the client has been emailed." : "Status updated.")
              }
            >
              <option value="open">Open</option>
              <option value="waiting_on_client">Waiting on client</option>
              <option value="resolved">Resolved</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="ticket_priority">Priority</Label>
            <Select id="ticket_priority" value={priority} disabled={pending} onChange={(e) => change({ priority: e.target.value }, "Priority updated.")}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <form
      className="space-y-3 border-t border-slate-100 pt-5"
      action={(fd) =>
        start(async () => {
          const r = await replyToTicket(ticketId, fd);
          if (r.ok) {
            toast.success(internal ? "Note added." : "Reply sent to the client.");
            setBody("");
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      <div className="flex items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={!internal} onChange={() => setInternal(false)} className="h-4 w-4" /> Reply to client
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={internal} onChange={() => setInternal(true)} className="h-4 w-4" /> Internal note
        </label>
      </div>
      {internal && <input type="hidden" name="internal" value="on" />}
      <Textarea
        name="body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? "Only admins see this — the client is not told." : "Your reply — the client gets it by email and in the portal."}
        className={internal ? "border-amber-300 bg-amber-50/50" : undefined}
        required
      />
      <div className="flex flex-wrap items-center gap-3">
        {!internal && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Then mark it</span>
            <Select name="status" value={after} onChange={(e) => setAfter(e.target.value)} className="w-auto py-1.5">
              <option value="waiting_on_client">Waiting on client</option>
              <option value="open">Still open</option>
              <option value="resolved">Resolved</option>
            </Select>
          </div>
        )}
        <Button type="submit" loading={pending} className="ml-auto">
          <Send className="h-4 w-4" /> {internal ? "Add note" : "Send reply"}
        </Button>
      </div>
    </form>
  );
}
