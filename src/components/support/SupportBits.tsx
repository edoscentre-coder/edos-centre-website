import { cn } from "@/lib/utils";

/**
 * Pieces the admin and the client portal share, so a request reads the same on
 * both sides. Labels are repeated here rather than imported from
 * lib/support/support, which is server-only.
 */

const STATUS: Record<string, { label: string; clientLabel: string; cls: string }> = {
  open: { label: "Open", clientLabel: "With EDOS Centre", cls: "bg-blue-50 text-blue-700 ring-blue-600/20" },
  waiting_on_client: { label: "Waiting on client", clientLabel: "Waiting for you", cls: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  resolved: { label: "Resolved", clientLabel: "Resolved", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
};

const PRIORITY: Record<string, string> = {
  low: "bg-slate-50 text-slate-600 ring-slate-500/20",
  normal: "bg-slate-50 text-slate-600 ring-slate-500/20",
  high: "bg-orange-50 text-orange-700 ring-orange-600/20",
  urgent: "bg-red-50 text-red-700 ring-red-600/20",
};

export const CATEGORY_LABEL: Record<string, string> = {
  change_request: "Change request",
  bug: "Something isn't working",
  billing: "Billing",
  other: "Other",
};

const pill = "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset";

export function TicketStatus({ status, forClient = false }: { status: string; forClient?: boolean }) {
  const s = STATUS[status] ?? { label: status, clientLabel: status, cls: "bg-slate-100 text-slate-600 ring-slate-500/20" };
  return <span className={cn(pill, s.cls)}>{forClient ? s.clientLabel : s.label}</span>;
}

export function TicketPriority({ priority }: { priority: string }) {
  return <span className={cn(pill, "capitalize", PRIORITY[priority] ?? PRIORITY.normal)}>{priority}</span>;
}

export const when = (d: string) =>
  new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export interface ThreadMessage {
  id: string;
  author_type: "client" | "admin";
  author_name: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

/** The conversation, oldest first. `viewer` decides which side reads as "you". */
export function Thread({ messages, viewer }: { messages: ThreadMessage[]; viewer: "admin" | "client" }) {
  return (
    <ol className="space-y-4">
      {messages.map((m) => {
        const mine = m.author_type === viewer;
        const who = m.author_type === "admin" ? (viewer === "client" ? "EDOS Centre" : m.author_name || "EDOS Centre") : m.author_name || "Client";
        return (
          <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 text-sm",
                m.is_internal
                  ? "border border-dashed border-amber-300 bg-amber-50 text-amber-950"
                  : mine
                    ? "bg-[#1A1733] text-white"
                    : "bg-slate-100 text-slate-900",
              )}
            >
              <div className={cn("mb-1 flex items-center gap-2 text-xs", mine && !m.is_internal ? "text-slate-300" : "text-slate-500")}>
                <span className="font-semibold">{who}</span>
                {m.is_internal && <span className="font-semibold uppercase tracking-wide text-amber-700">Internal note</span>}
                <span>{when(m.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
