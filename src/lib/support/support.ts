import "server-only";
import { Resend } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import { absoluteUrl } from "@/lib/seo";
import { getSiteSettings } from "@/lib/queries";
import { getBillingSettings } from "@/lib/admin/billing-settings";

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

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The EDOS email shell, as the billing emails use it: logo, headline, lead, the message quoted, one button. */
function supportEmailHtml(o: { headline: string; lead: string; quote?: string; rows: [string, string][]; cta: string; url: string; footer: string }) {
  const rows = o.rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:8px 16px 8px 0;font-size:14px;color:#5b625d;white-space:nowrap;vertical-align:top;${i ? "border-top:1px solid #e2e6e2;" : ""}">${esc(k)}</td><td style="padding:8px 0;font-size:14px;text-align:right;font-weight:700;${i ? "border-top:1px solid #e2e6e2;" : ""}">${esc(v)}</td></tr>`,
    )
    .join("");
  const quote = o.quote
    ? `<div style="margin:18px 0 0;padding:14px 16px;background:#f4f6f4;border-left:3px solid #0b7a44;border-radius:6px;font-size:14px;line-height:1.6;color:#171a19;white-space:pre-wrap;">${esc(o.quote)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171a19;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e6e2;">
      <tr><td style="padding:26px 28px 6px;">
        <img src="${esc(absoluteUrl("/EDOS-LOGOty-1.png"))}" alt="EDOS Centre" height="40" style="display:block;height:40px;width:auto;border:0;" />
        <h1 style="margin:18px 0 0;font-size:22px;line-height:1.3;color:#171a19;">${esc(o.headline)}</h1>
      </td></tr>
      <tr><td style="padding:10px 28px 4px;">
        <p style="margin:0;font-size:15px;line-height:1.6;">${esc(o.lead)}</p>
        ${quote}
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0 0;border-top:1px solid #e2e6e2;">${rows}</table>
        <p style="margin:22px 0 0;">
          <a href="${esc(o.url)}" style="display:inline-block;background:#0b7a44;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:8px;">${esc(o.cta)}</a>
        </p>
      </td></tr>
      <tr><td style="padding:18px 28px 26px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#5b625d;border-top:1px solid #e2e6e2;padding-top:14px;">${esc(o.footer)}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

async function send(to: string[], subject: string, html: string, text: string, replyTo?: string | null) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from || !to.length) return;
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: `Edos Centre <${from}>`,
      to,
      subject,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
    });
    if (error) console.error("[support] email failed:", error.message);
  } catch (err) {
    console.error("[support] email failed:", err);
  }
}

async function footer() {
  const site = await getSiteSettings();
  return `EDOS Centre · ${site.contact_email || "info@edoscentre.co.ke"} · ${site.contact_phone || "+254 721 201 287"}`;
}

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

async function superAdmins(): Promise<{ id: string; email: string }[]> {
  const supabase = await createServiceClient();
  const { data } = await supabase.from("edoscentreadmin_admin_users").select("id, email").eq("role", "super_admin").eq("is_active", true);
  return data ?? [];
}

/** Admins: a bell notification each, and an email. Best-effort — never stops the request being saved. */
export async function tellAdmins(t: Ticket, kind: "new" | "client_reply", body: string, messageId: string) {
  try {
    const admins = await superAdmins();
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
    const url = absoluteUrl(`/admin/support/${t.id}`);
    const f = await footer();
    const rows: [string, string][] = [
      ["Request", t.ticket_number],
      ["Client", client],
      ...(t.edoscentreadmin_websites?.name ? [["Website", t.edoscentreadmin_websites.name] as [string, string]] : []),
      ["Category", CATEGORIES[t.category]],
      ["Priority", PRIORITIES[t.priority]],
    ];
    const lead = kind === "new" ? `${client} opened a support request: “${t.subject}”.` : `${client} replied on “${t.subject}”.`;
    await send(
      admins.map((a) => a.email),
      `${title}: ${t.subject}`,
      supportEmailHtml({ headline: title, lead, quote: body, rows, cta: "Open in the admin", url, footer: f }),
      [title, "", lead, "", body, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", `Open: ${url}`].join("\n"),
      t.edoscentreadmin_clients?.email,
    );
  } catch (err) {
    console.error("[support] admin notice failed:", err);
  }
}

/** The client: an email when EDOS replies or resolves. Best-effort, like tellAdmins. */
export async function tellClient(t: Ticket, kind: "reply" | "resolved", body: string | null) {
  try {
    const to = await clientRecipients(t.client_id, t.edoscentreadmin_clients?.email ?? null);
    if (!to.length) return;
    const billing = await getBillingSettings();
    const url = absoluteUrl(`/portal/support/${t.id}`);
    const f = await footer();
    const headline = kind === "reply" ? `New reply on ${t.ticket_number}` : `${t.ticket_number} is resolved`;
    const lead =
      kind === "reply"
        ? `EDOS Centre has replied to your request “${t.subject}”.`
        : `We've marked your request “${t.subject}” as resolved. If anything still isn't right, reply in the portal and it opens again.`;
    const rows: [string, string][] = [
      ["Request", t.ticket_number],
      ...(t.edoscentreadmin_websites?.name ? [["Website", t.edoscentreadmin_websites.name] as [string, string]] : []),
      ["Status", kind === "resolved" ? "Resolved" : "Waiting for you"],
    ];
    await send(
      to,
      `${headline} — ${t.subject}`,
      supportEmailHtml({ headline, lead, quote: body ?? undefined, rows, cta: "View in the client portal", url, footer: f }),
      [headline, "", lead, ...(body ? ["", body] : []), "", ...rows.map(([k, v]) => `${k}: ${v}`), "", `View: ${url}`, "", f].join("\n"),
      billing.reply_to_email,
    );
  } catch (err) {
    console.error("[support] client notice failed:", err);
  }
}
