import "server-only";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/admin/audit";
import { sendInvoiceStatusEmail } from "@/lib/admin/invoice-email";
import type { BillingSettings } from "@/lib/admin/billing-settings";

/**
 * Automatic suspension (migration 028), run by the daily sweep when both the
 * master switch and "Suspend websites automatically" are on.
 *
 * For an unpaid invoice linked to a subscription and a website:
 *
 *   suspension date = due date + the subscription's grace period
 *   notice date     = suspension date - notice days
 *
 * On or after the notice date a final notice is emailed, once. On or after the
 * suspension date the website is suspended and the client told — but only if
 * that notice went out at least `notice days` earlier, so no client is ever
 * suspended without warning. If the notice could not be sent (no email on
 * file), nothing is suspended and admins are told instead.
 *
 * Paying the invoice in full reactivates the site through billing-cascade.ts,
 * which already does exactly that for subscription invoices — the reason only
 * subscription-linked invoices are considered here.
 */

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => iso(new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY));

export type SuspensionStage = "waiting" | "notice_due" | "notice_sent" | "suspend_due" | "blocked";

export interface SuspensionCandidate {
  invoiceId: string;
  invoiceNumber: string;
  websiteId: string;
  websiteSlug: string;
  website: string;
  client: string;
  clientEmail: string | null;
  balance: number;
  currency: string;
  dueDate: string;
  noticeDate: string;
  suspendDate: string;
  noticeSentAt: string | null;
  stage: SuspensionStage;
  /** Why it is blocked or waiting, for the preview. */
  note: string;
}

type Row = {
  id: string;
  invoice_number: string;
  due_date: string;
  total: number;
  currency: string;
  status: string;
  website_id: string;
  suspension_notice_sent_at: string | null;
  suspended_at: string | null;
  edoscentreadmin_websites: { name: string; slug: string; status: string } | null;
  edoscentreadmin_clients: { company_name: string; email: string | null } | null;
  edoscentreadmin_subscriptions: { grace_period_days: number; auto_suspend: boolean | null; status: string } | null;
};

/**
 * The decision for one invoice, from dates alone — pure, so the rules can be
 * checked without a database. A notice sent late pushes the suspension back:
 * the client always gets the full notice period.
 */
export function suspensionPlan(x: {
  dueDate: string;
  graceDays: number;
  noticeDays: number;
  noticeSentAt: string | null;
  hasEmail: boolean;
  today: string;
}): { stage: SuspensionStage; note: string; noticeDate: string; suspendDate: string } {
  const scheduled = addDays(x.dueDate, Math.max(0, x.graceDays));
  const noticeDate = addDays(scheduled, -x.noticeDays);
  if (!x.noticeSentAt) {
    if (x.today < noticeDate) return { stage: "waiting", note: `Final notice on ${noticeDate}`, noticeDate, suspendDate: scheduled };
    // Sent today at the earliest, so suspension can be no sooner than notice days from today.
    const suspendDate = [scheduled, addDays(x.today, x.noticeDays)].sort()[1];
    if (!x.hasEmail) return { stage: "blocked", note: "No client email — cannot warn, so will not suspend", noticeDate, suspendDate };
    return { stage: "notice_due", note: "Final notice goes out today", noticeDate, suspendDate };
  }
  const earliest = addDays(iso(new Date(x.noticeSentAt)), x.noticeDays);
  const suspendDate = earliest > scheduled ? earliest : scheduled;
  if (x.today >= suspendDate) return { stage: "suspend_due", note: "Suspends today", noticeDate, suspendDate };
  return { stage: "notice_sent", note: `Notice sent; suspends on ${suspendDate}`, noticeDate, suspendDate };
}

export async function findSuspensions(settings: BillingSettings, today = new Date()): Promise<SuspensionCandidate[]> {
  const supabase = await createServiceClient();
  const todayStr = iso(today);
  const { data, error } = await supabase
    .from("edoscentreadmin_invoices")
    .select(
      "id, invoice_number, due_date, total, currency, status, website_id, suspension_notice_sent_at, suspended_at, edoscentreadmin_websites(name, slug, status), edoscentreadmin_clients(company_name, email), edoscentreadmin_subscriptions(grace_period_days, auto_suspend, status)",
    )
    .in("status", ["sent", "pending", "partially_paid", "overdue"])
    .not("subscription_id", "is", null)
    .not("website_id", "is", null)
    .is("suspended_at", null)
    .lt("due_date", todayStr)
    .order("due_date");
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return [];

  const { data: payments } = await supabase
    .from("edoscentreadmin_payments")
    .select("invoice_id, amount")
    .in("invoice_id", rows.map((r) => r.id))
    .eq("status", "completed");
  const paidBy = new Map<string, number>();
  for (const p of payments ?? []) paidBy.set(p.invoice_id, (paidBy.get(p.invoice_id) ?? 0) + Number(p.amount));

  const out: SuspensionCandidate[] = [];
  for (const r of rows) {
    const site = r.edoscentreadmin_websites;
    const sub = r.edoscentreadmin_subscriptions;
    if (!site || !sub) continue;
    // EDOS Centre's own site, sites already suspended or in maintenance, and
    // subscriptions an admin has excluded are never touched.
    if (site.slug === "edos-centre" || site.status !== "active") continue;
    if (sub.auto_suspend === false) continue;
    if (["suspended", "cancelled", "expired"].includes(sub.status)) continue;

    const plan = suspensionPlan({
      dueDate: r.due_date,
      graceDays: sub.grace_period_days ?? 7,
      noticeDays: settings.suspension_notice_days,
      noticeSentAt: r.suspension_notice_sent_at,
      hasEmail: Boolean(r.edoscentreadmin_clients?.email),
      today: todayStr,
    });
    const email = r.edoscentreadmin_clients?.email ?? null;

    out.push({
      invoiceId: r.id,
      invoiceNumber: r.invoice_number,
      websiteId: r.website_id,
      websiteSlug: site.slug,
      website: site.name.trim(),
      client: (r.edoscentreadmin_clients?.company_name ?? "Client").trim(),
      clientEmail: email,
      balance: Math.max(0, Number(r.total) - (paidBy.get(r.id) ?? 0)),
      currency: r.currency,
      dueDate: r.due_date,
      noticeDate: plan.noticeDate,
      suspendDate: plan.suspendDate,
      noticeSentAt: r.suspension_notice_sent_at,
      stage: plan.stage,
      note: plan.note,
    });
  }
  return out;
}

export interface SuspensionResult {
  noticesSent: { invoiceNumber: string; website: string }[];
  suspended: { invoiceNumber: string; website: string; emailed: boolean }[];
  blocked: { invoiceNumber: string; website: string; reason: string }[];
}

/** The sweep's step: send due final notices, then suspend what is due. */
export async function runAutoSuspend(settings: BillingSettings): Promise<SuspensionResult> {
  const supabase = await createServiceClient();
  const result: SuspensionResult = { noticesSent: [], suspended: [], blocked: [] };

  for (const c of await findSuspensions(settings)) {
    if (c.stage === "blocked") {
      result.blocked.push({ invoiceNumber: c.invoiceNumber, website: c.website, reason: c.note });
      continue;
    }

    if (c.stage === "notice_due") {
      const sent = await sendInvoiceStatusEmail(c.invoiceId, "suspension_notice", { suspendOn: c.suspendDate });
      if (sent.sent) {
        // Conditional on it still being unset, so overlapping runs send one notice.
        await supabase
          .from("edoscentreadmin_invoices")
          .update({ suspension_notice_sent_at: new Date().toISOString() })
          .eq("id", c.invoiceId)
          .is("suspension_notice_sent_at", null);
        await logAudit({ actorId: null, action: "suspension_notice_emailed", websiteId: c.websiteId, metadata: { invoice_number: c.invoiceNumber, suspend_on: c.suspendDate } });
        result.noticesSent.push({ invoiceNumber: c.invoiceNumber, website: c.website });
      } else {
        // Not sent means not warned, and not warned means not suspended.
        result.blocked.push({ invoiceNumber: c.invoiceNumber, website: c.website, reason: `Final notice not sent: ${sent.reason}` });
      }
      continue;
    }

    if (c.stage === "suspend_due") {
      const { data: moved, error } = await supabase
        .from("edoscentreadmin_websites")
        .update({
          status: "suspended",
          status_reason: `Payment overdue — ${c.invoiceNumber}`,
          status_message: settings.suspension_message,
          maintenance_return_at: null,
          status_changed_at: new Date().toISOString(),
          status_changed_by: null,
        })
        .eq("id", c.websiteId)
        .eq("status", "active")
        .select("id");
      if (error || !moved?.length) continue;

      await supabase.from("edoscentreadmin_invoices").update({ suspended_at: new Date().toISOString() }).eq("id", c.invoiceId);
      await logAudit({ actorId: null, action: "website_auto_suspended", websiteId: c.websiteId, metadata: { invoice_number: c.invoiceNumber, balance: c.balance } });
      const mail = await sendInvoiceStatusEmail(c.invoiceId, "website_suspended");
      result.suspended.push({ invoiceNumber: c.invoiceNumber, website: c.website, emailed: mail.sent });
    }
  }

  if (result.suspended.length) revalidatePath("/", "layout");
  return result;
}
