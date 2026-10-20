import Link from "next/link";
import { Card, CardBody } from "@/components/admin/ui/Card";
import { listTickets, ticketCounts, type Status } from "@/lib/support/support";
import { CATEGORY_LABEL, TicketPriority, TicketStatus, when } from "@/components/support/SupportBits";
import { cn } from "@/lib/utils";

export const metadata = { title: "Support — EDOS Control Centre" };
export const dynamic = "force-dynamic";

const FILTERS: { key: Status | "all"; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "waiting_on_client", label: "Waiting on client" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];

export default async function SupportInboxPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await searchParams;
  const status = (FILTERS.some((f) => f.key === raw) ? raw : "open") as Status | "all";

  let tickets: Awaited<ReturnType<typeof listTickets>> = [];
  let counts = { open: 0, waiting_on_client: 0, resolved: 0 };
  let ready = true;
  try {
    [tickets, counts] = await Promise.all([listTickets(status), ticketCounts()]);
  } catch {
    ready = false;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Support</h1>
        <p className="mt-1 text-sm text-slate-500">Requests clients raise from the client portal. Replies are emailed to them.</p>
      </div>

      {!ready ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Run <code className="font-mono">supabase/migrations/029_support_desk.sql</code> in Supabase to switch the support desk on.
        </div>
      ) : (
        <>
          <nav className="flex flex-wrap gap-2" aria-label="Filter requests">
            {FILTERS.map((f) => {
              const n = f.key === "all" ? counts.open + counts.waiting_on_client + counts.resolved : counts[f.key];
              return (
                <Link
                  key={f.key}
                  href={`/admin/support?status=${f.key}`}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-sm font-medium ring-1 ring-inset",
                    status === f.key ? "bg-[#1A1733] text-white ring-[#1A1733]" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                  )}
                >
                  {f.label} <span className="ml-1 opacity-70">{n}</span>
                </Link>
              );
            })}
          </nav>

          <Card>
            <CardBody className="p-0">
              {tickets.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-slate-500">
                  {status === "open" ? "Nothing waiting on EDOS Centre." : "No requests here."}
                </p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {tickets.map((t) => (
                    <li key={t.id}>
                      <Link href={`/admin/support/${t.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-slate-500">{t.ticket_number}</span>
                            <span className="truncate font-medium text-slate-900">{t.subject}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {t.edoscentreadmin_clients?.company_name ?? "—"}
                            {t.edoscentreadmin_websites?.name && ` · ${t.edoscentreadmin_websites.name}`} · {CATEGORY_LABEL[t.category] ?? t.category} · last
                            activity {when(t.last_message_at)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {(t.priority === "high" || t.priority === "urgent") && <TicketPriority priority={t.priority} />}
                          <TicketStatus status={t.status} />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
