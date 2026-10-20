import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/seo";
import { getBillingSettings } from "@/lib/admin/billing-settings";
import { edosContacts, sendEdosEmail, superAdmins } from "@/lib/email/edos-email";

/**
 * The support desk (migration 029): clients raise requests from the portal,
 * admins answer them in the admin. Every write here runs as the service role
 * and is only ever called after the caller has been checked — an admin by
 * requireAdmin, a client by requirePortalUser and the ticket's client_id.
 */

export const CATEGORIES = {
  change_request: "Change request",
  bug: "Something isn't working",
  billing: "Billing",
  other: "Other",
} as const;
export const PRIORITIES = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" } as const;
export const STATUSES = { open: "Open", waiting_on_client: "Waiting on client", resolved: "Resolved" } as const;

export type Category = keyof typeof CATEGORIES;
export type Priority = keyof typeof PRIORITIES;
export type Status = keyof typeof STATUSES;

export interface TicketMessage {
  id: string;
  author_type: "client" | "admin";
  author_name: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

export interface Ticket {
  id: string;
  ticket_number: string;
  client_id: string;
  website_id: string | null;
  subject: string;
  category: Category;
  priority: Priority;
  status: Status;
  last_message_at: string;
  resolved_at: string | null;
  created_at: string;
  edoscentreadmin_clients: { company_name: string; email: string | null } | null;
  edoscentreadmin_websites: { name: string } | null;
}

const TICKET_COLUMNS =
  "id, ticket_number, client_id, website_id, subject, category, priority, status, last_message_at, resolved_at, created_at, edoscentreadmin_clients(company_name, email), edoscentreadmin_websites(name)";

// ── Reading (admin) ─────────────────────────────────────────────────────────

export async function listTickets(status: Status | "all" = "all"): Promise<Ticket[]> {
  const supabase = await createServiceClient();
  let q = supabase.from("edoscentreadmin_support_tickets").select(TICKET_COLUMNS).order("last_message_at", { ascending: false }).limit(300);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Ticket[];
}

export async function ticketCounts(): Promise<Record<Status, number>> {
  const supabase = await createServiceClient();
  const { data } = await supabase.from("edoscentreadmin_support_tickets").select("status");
  const counts: Record<Status, number> = { open: 0, waiting_on_client: 0, resolved: 0 };
  for (const r of data ?? []) counts[r.status as Status] = (counts[r.status as Status] ?? 0) + 1;
  return counts;
}

/** A ticket and its whole conversation; internal notes only when `withInternal`. */
export async function getTicket(id: string, opts: { clientId?: string; withInternal: boolean }) {
  const supabase = await createServiceClient();
  let q = supabase.from("edoscentreadmin_support_tickets").select(TICKET_COLUMNS).eq("id", id);
  if (opts.clientId) q = q.eq("client_id", opts.clientId);
  const { data: ticket } = await q.maybeSingle();
  if (!ticket) return null;

  let m = supabase
    .from("edoscentreadmin_support_messages")
    .select("id, author_type, author_name, body, is_internal, created_at")
    .eq("ticket_id", id)
    .order("created_at");
  if (!opts.withInternal) m = m.eq("is_internal", false);
  const { data: messages } = await m;
  return { ticket: ticket as unknown as Ticket, messages: (messages ?? []) as TicketMessage[] };
}

// ── Writing ─────────────────────────────────────────────────────────────────

export async function createTicket(input: {
  clientId: string;
  websiteId: string | null;
  subject: string;
  category: Category;
  priority: Priority;
  body: string;
  portalUserId: string | null;
  adminId: string | null;
  authorName: string;
}): Promise<{ id: string; number: string }> {
  const supabase = await createServiceClient();
  const { data: number, error: numberError } = await supabase.rpc("edoscentreadmin_next_ticket_number");
  if (numberError || !number) throw new Error(numberError?.message ?? "Could not number the request.");

  const { data: ticket, error } = await supabase
    .from("edoscentreadmin_support_tickets")
    .insert({
      ticket_number: number,
      client_id: input.clientId,
      website_id: input.websiteId,
      subject: input.subject,
      category: input.category,
      priority: input.priority,
      status: "open",
      opened_by_portal_user: input.portalUserId,
      opened_by_admin: input.adminId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  const { error: msgError } = await supabase.from("edoscentreadmin_support_messages").insert({
    ticket_id: ticket.id,
    author_type: input.adminId ? "admin" : "client",
    author_admin_id: input.adminId,
    author_portal_user_id: input.portalUserId,
    author_name: input.authorName,
    body: input.body,
  });
  if (msgError) throw new Error(msgError.message);
  return { id: ticket.id, number };
}

export async function addMessage(input: {
  ticketId: string;
  authorType: "client" | "admin";
  adminId?: string | null;
  portalUserId?: string | null;
  authorName: string;
  body: string;
  isInternal?: boolean;
  /** The status the ticket moves to; unchanged when omitted. */
  status?: Status;
}): Promise<string> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("edoscentreadmin_support_messages")
    .insert({
      ticket_id: input.ticketId,
      author_type: input.authorType,
      author_admin_id: input.adminId ?? null,
      author_portal_user_id: input.portalUserId ?? null,
      author_name: input.authorName,
      body: input.body,
      is_internal: Boolean(input.isInternal),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  // An internal note is not part of the conversation: it moves nothing.
  if (!input.isInternal) {
    await supabase
      .from("edoscentreadmin_support_tickets")
      .update({
        last_message_at: new Date().toISOString(),
        ...(input.status ? { status: input.status, resolved_at: input.status === "resolved" ? new Date().toISOString() : null } : {}),
      })
      .eq("id", input.ticketId);
  }
  return data.id;
}

export async function updateTicket(id: string, patch: { status?: Status; priority?: Priority }) {
  const supabase = await createServiceClient();
  const { error } = await supabase
    .from("edoscentreadmin_support_tickets")
    .update({
      ...patch,
      ...(patch.status ? { resolved_at: patch.status === "resolved" ? new Date().toISOString() : null } : {}),
    })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Telling people ──────────────────────────────────────────────────────────

/** The client's people: every active portal user of that client, or the client's own email when none. */
async function clientRecipients(clientId: string, fallback: string | null): Promise<string[]> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("edoscentreadmin_client_portal_users")
    .select("email")
    .eq("client_id", clientId)
    .eq("is_active", true);
  const emails = [...new Set((data ?? []).map((u) => u.email).filter(Boolean))];
  return emails.length ? emails : fallback ? [fallback] : [];
}

/**
 * EDOS Centre: a bell notification for each super admin, and an email to them
 * and to EDOS Centre's inbox (Settings → Business details). Best-effort —
 * never stops the request being saved.
 */
export async function tellAdmins(t: Ticket, kind: "new" | "client_reply", body: string, messageId: string) {
  try {
    const [admins, { inbox }] = await Promise.all([superAdmins(), edosContacts()]);
    const supabase = await createServiceClient();
    const title = kind === "new" ? `New support request — ${t.ticket_number}` : `Client replied — ${t.ticket_number}`;
    const client = t.edoscentreadmin_clients?.company_name ?? "A client";
    if (admins.length) {
      await supabase.from("edoscentreadmin_notifications").upsert(
        admins.map((a) => ({
          recipient_id: a.id,
          type: kind === "new" ? "support_new" : "support_reply",
          severity: t.priority === "urgent" || t.priority === "high" ? "warning" : "info",
          title,
          message: `${client}: ${t.subject}`,
          link: `/admin/support/${t.id}`,
          dedup_key: `support:${messageId}`,
        })),
        { onConflict: "recipient_id,dedup_key", ignoreDuplicates: true },
      );
    }
    await sendEdosEmail({
      to: [inbox, ...admins.map((a) => a.email)],
      subject: `${title}: ${t.subject}`,
      replyTo: t.edoscentreadmin_clients?.email,
      email: {
        headline: title,
        lead: kind === "new" ? `${client} opened a support request: “${t.subject}”.` : `${client} replied on “${t.subject}”.`,
        quote: body,
        rows: [
          ["Request", t.ticket_number],
          ["Client", client],
          ...(t.edoscentreadmin_websites?.name ? [["Website", t.edoscentreadmin_websites.name] as [string, string]] : []),
          ["Category", CATEGORIES[t.category]],
          ["Priority", PRIORITIES[t.priority]],
        ],
        cta: "Open in the admin",
        url: absoluteUrl(`/admin/support/${t.id}`),
      },
    });
  } catch (err) {
    console.error("[support] admin notice failed:", err);
  }
}

/** The client: an email when EDOS replies or resolves. Best-effort, like tellAdmins. */
export async function tellClient(t: Ticket, kind: "reply" | "resolved", body: string | null) {
  try {
    const to = await clientRecipients(t.client_id, t.edoscentreadmin_clients?.email ?? null);
    if (!to.length) return;
    const [billing, { inbox }] = await Promise.all([getBillingSettings(), edosContacts()]);
    const headline = kind === "reply" ? `New reply on ${t.ticket_number}` : `${t.ticket_number} is resolved`;
    await sendEdosEmail({
      to,
      subject: `${headline} — ${t.subject}`,
      replyTo: billing.reply_to_email || inbox,
      email: {
        headline,
        lead:
          kind === "reply"
            ? `EDOS Centre has replied to your request “${t.subject}”.`
            : `We've marked your request “${t.subject}” as resolved. If anything still isn't right, reply in the portal and it opens again.`,
        quote: body ?? undefined,
        rows: [
          ["Request", t.ticket_number],
          ...(t.edoscentreadmin_websites?.name ? [["Website", t.edoscentreadmin_websites.name] as [string, string]] : []),
          ["Status", kind === "resolved" ? "Resolved" : "Waiting for you"],
        ],
        cta: "View in the client portal",
        url: absoluteUrl(`/portal/support/${t.id}`),
      },
    });
  } catch (err) {
    console.error("[support] client notice failed:", err);
  }
}
