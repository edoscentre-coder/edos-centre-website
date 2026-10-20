import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/admin/ui/Card";
import { getTicket } from "@/lib/support/support";
import { CATEGORY_LABEL, Thread, TicketStatus, when } from "@/components/support/SupportBits";
import AdminTicketControls from "@/components/support/AdminTicketControls";

export const metadata = { title: "Support request — EDOS Control Centre" };
export const dynamic = "force-dynamic";

export default async function AdminTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const found = await getTicket(id, { withInternal: true }).catch(() => null);
  if (!found) notFound();
  const { ticket: t, messages } = found;

  return (
    <div className="space-y-6">
      <Link href="/admin/support" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> All requests
      </Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-slate-500">{t.ticket_number}</span>
              <TicketStatus status={t.status} />
            </div>
            <h1 className="mt-1 text-lg font-semibold text-slate-900">{t.subject}</h1>
          </CardHeader>
          <CardBody className="space-y-6">
            <Thread messages={messages} viewer="admin" />
            <AdminTicketControls ticketId={t.id} status={t.status} priority={t.priority} part="reply" />
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardBody>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-xs text-slate-500">Client</dt>
                  <dd className="font-medium text-slate-900">{t.edoscentreadmin_clients?.company_name ?? "—"}</dd>
                  {t.edoscentreadmin_clients?.email && <dd className="text-xs text-slate-500">{t.edoscentreadmin_clients.email}</dd>}
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Website</dt>
                  <dd className="text-slate-800">{t.edoscentreadmin_websites?.name ?? "Not specified"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Category</dt>
                  <dd className="text-slate-800">{CATEGORY_LABEL[t.category] ?? t.category}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Opened</dt>
                  <dd className="text-slate-800">{when(t.created_at)}</dd>
                </div>
                {t.resolved_at && (
                  <div>
                    <dt className="text-xs text-slate-500">Resolved</dt>
                    <dd className="text-slate-800">{when(t.resolved_at)}</dd>
                  </div>
                )}
              </dl>
            </CardBody>
          </Card>
          <AdminTicketControls ticketId={t.id} status={t.status} priority={t.priority} part="meta" />
        </div>
      </div>
    </div>
  );
}
