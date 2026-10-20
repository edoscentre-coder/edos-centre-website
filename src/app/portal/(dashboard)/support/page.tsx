import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMySubscriptions } from "@/lib/portal/queries";
import { Card, CardBody, CardHeader } from "@/components/admin/ui/Card";
import { CATEGORY_LABEL, TicketStatus, when } from "@/components/support/SupportBits";
import NewSupportRequest from "@/components/support/NewSupportRequest";

export const metadata = { title: "Support — EDOS Client Portal" };
export const dynamic = "force-dynamic";

type MyTicket = {
  id: string;
  ticket_number: string;
  subject: string;
  category: string;
  status: string;
  last_message_at: string;
  edoscentreadmin_websites: { name: string } | null;
};

export default async function PortalSupportPage() {
  // RLS (migration 029) shows a portal user only their own client's requests.
  const supabase = await createClient();
  const [{ data, error }, subscriptions] = await Promise.all([
    supabase
      .from("edoscentreadmin_support_tickets")
      .select("id, ticket_number, subject, category, status, last_message_at, edoscentreadmin_websites(name)")
      .order("last_message_at", { ascending: false }),
    getMySubscriptions(),
  ]);
  const tickets = (data ?? []) as unknown as MyTicket[];
  const websites = [
    ...new Map(
      subscriptions.filter((s) => s.edoscentreadmin_websites).map((s) => [s.website_id, { id: s.website_id, name: s.edoscentreadmin_websites!.name }]),
    ).values(),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Support</h1>
        <p className="mt-1 text-sm text-slate-500">Ask EDOS Centre for a change, report a problem, or ask about billing. We reply here and by email.</p>
      </div>

      {error ? (
        <p className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Support isn&apos;t available yet. Please email us in the meantime.</p>
      ) : (
        <>
          <NewSupportRequest websites={websites} />

          <Card>
            <CardHeader>
              <h2 className="font-medium text-slate-900">Your requests</h2>
            </CardHeader>
            <CardBody className="p-0">
              {tickets.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-slate-400">No requests yet.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {tickets.map((t) => (
                    <li key={t.id}>
                      <Link href={`/portal/support/${t.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-slate-50">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-slate-400">{t.ticket_number}</span>
                            <span className="truncate font-medium text-slate-800">{t.subject}</span>
                          </div>
                          <div className="mt-1 text-xs text-slate-400">
                            {t.edoscentreadmin_websites?.name ? `${t.edoscentreadmin_websites.name} · ` : ""}
                            {CATEGORY_LABEL[t.category] ?? t.category} · updated {when(t.last_message_at)}
                          </div>
                        </div>
                        <TicketStatus status={t.status} forClient />
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
