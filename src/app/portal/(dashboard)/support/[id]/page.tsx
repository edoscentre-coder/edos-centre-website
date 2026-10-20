import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardBody, CardHeader } from "@/components/admin/ui/Card";
import { CATEGORY_LABEL, Thread, TicketStatus, type ThreadMessage } from "@/components/support/SupportBits";
import ClientReply from "@/components/support/ClientReply";

export const metadata = { title: "Support request — EDOS Client Portal" };
export const dynamic = "force-dynamic";

export default async function PortalTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // RLS (migration 029): the client's own ticket only, and never internal notes.
  const supabase = await createClient();
  const { data: ticket } = await supabase
    .from("edoscentreadmin_support_tickets")
    .select("id, ticket_number, subject, category, status, edoscentreadmin_websites(name)")
    .eq("id", id)
    .maybeSingle();
  if (!ticket) notFound();
  const { data: messages } = await supabase
    .from("edoscentreadmin_support_messages")
    .select("id, author_type, author_name, body, is_internal, created_at")
    .eq("ticket_id", id)
    .eq("is_internal", false)
    .order("created_at");

  const t = ticket as unknown as {
    id: string;
    ticket_number: string;
    subject: string;
    category: string;
    status: string;
    edoscentreadmin_websites: { name: string } | null;
  };

  return (
    <div className="space-y-6">
      <Link href="/portal/support" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Your requests
      </Link>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-400">{t.ticket_number}</span>
            <TicketStatus status={t.status} forClient />
          </div>
          <h1 className="mt-1 text-lg font-semibold text-slate-900">{t.subject}</h1>
          <p className="text-xs text-slate-400">
            {t.edoscentreadmin_websites?.name ? `${t.edoscentreadmin_websites.name} · ` : ""}
            {CATEGORY_LABEL[t.category] ?? t.category}
          </p>
        </CardHeader>
        <CardBody className="space-y-6">
          <Thread messages={(messages ?? []) as ThreadMessage[]} viewer="client" />
          <ClientReply ticketId={t.id} resolved={t.status === "resolved"} />
        </CardBody>
      </Card>
    </div>
  );
}
