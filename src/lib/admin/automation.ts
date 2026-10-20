import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/admin/audit";
import { sendInvoiceStatusEmail } from "@/lib/admin/invoice-email";
import { getBillingSettings } from "@/lib/admin/billing-settings";
import { createDueRenewalInvoices } from "@/lib/admin/renewal-invoices";
import { runAutoSuspend } from "@/lib/admin/auto-suspend";

const REMINDER_DAYS_BEFORE_DUE = 3;

type NotificationInsert = {
  recipient_id: string;
  type: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  link: string;
  dedup_key: string;
};

type SubscriptionRow = {
  id: string;
  website_id: string;
  status: string;
  renewal_date: string;
  grace_period_days: number;
  edoscentreadmin_websites: { name: string } | null;
};

type InvoiceRow = {
  id: string;
  invoice_number: string;
  due_date: string;
  edoscentreadmin_clients: { company_name: string } | null;
};

type DomainRow = {
  id: string;
  domain_name: string;
  expiry_date: string;
  edoscentreadmin_websites: { name: string } | null;
};

type SslRow = {
  id: string;
  provider: string;
  expiry_date: string;
  edoscentreadmin_websites: { name: string } | null;
};

function daysUntil(dateStr: string, today: Date): number {
  return Math.ceil((new Date(dateStr).getTime() - today.getTime()) / 86400000);
}

function expiryBucket(daysLeft: number): "expired" | "expiring_7" | "expiring_30" | null {
  if (daysLeft < 0) return "expired";
  if (daysLeft <= 7) return "expiring_7";
  if (daysLeft <= 30) return "expiring_30";
  return null;
}

/**
 * Sweeps subscription/invoice lifecycle dates, expiring domains and SSL certs, and
 * writes de-duplicated per-admin notifications. Also emails clients directly: one
 * "due soon" reminder a few days before an invoice's due date, and one "overdue"
 * notice the day it crosses it — each gated by its own *_sent_at column so re-running
 * the sweep never re-sends either (unlike the admin notifications below, these have
 * no dedup_key to fall back on, since they're one-shot rather than re-evaluated each
 * run). Never auto-suspends a website or cancels anything — suspension stays a
 * deliberate admin action; this only advances the billing state machine
 * (due_soon -> grace_period -> overdue) and flags invoices past their due date, plus
 * alerts on domain/SSL expiry. Safe to call repeatedly.
 */
export async function runAutomationSweep() {
  const supabase = await createServiceClient();
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const { data: recipients } = await supabase
    .from("edoscentreadmin_admin_users")
    .select("id")
    .eq("role", "super_admin")
    .eq("is_active", true);
  const recipientIds = (recipients ?? []).map((r) => r.id);

  const notifications: NotificationInsert[] = [];
  let subscriptionsUpdated = 0;
  let invoicesUpdated = 0;

  // Renewal invoices (migration 026) — only when switched on under Billing
  // automation. Everything after this step runs exactly as it did before.
  let renewalInvoicesCreated = 0;
  const billing = await getBillingSettings();
  if (billing.migrated && billing.automation_enabled && billing.renewal_invoices) {
    for (const r of await createDueRenewalInvoices(billing)) {
      renewalInvoicesCreated++;
      for (const recipientId of recipientIds) {
        notifications.push({
          recipient_id: recipientId,
          type: "renewal_invoice",
          severity: r.status === "draft" ? "warning" : "info",
          title:
            r.status === "draft"
              ? `Renewal invoice ready to send — ${r.website}`
              : `Renewal invoice ${r.emailed ? "emailed" : "issued (email not sent)"} — ${r.website}`,
          message: `${r.invoiceNumber} for ${r.client}.${r.emailNote ? ` ${r.emailNote}` : ""}`,
          link: "/admin/settings/billing",
          dedup_key: `renewal_invoice:${r.invoiceId}`,
        });
      }
    }
  }

  const { data: subs } = await supabase
    .from("edoscentreadmin_subscriptions")
    .select("id, website_id, status, renewal_date, grace_period_days, edoscentreadmin_websites(name)")
    .in("status", ["trial", "active", "due_soon", "grace_period"])
    .not("renewal_date", "is", null);

  for (const sub of (subs ?? []) as unknown as SubscriptionRow[]) {
    const daysToRenewal = daysUntil(sub.renewal_date, today);
    const graceCutoff = new Date(sub.renewal_date);
    graceCutoff.setDate(graceCutoff.getDate() + (sub.grace_period_days ?? 0));
    const daysToGraceCutoff = Math.ceil((graceCutoff.getTime() - today.getTime()) / 86400000);

    let target: string | null = null;
    if (daysToRenewal < 0 && daysToGraceCutoff < 0) target = "overdue";
    else if (daysToRenewal < 0) target = "grace_period";
    else if (daysToRenewal <= 7) target = "due_soon";

    if (target && target !== sub.status) {
      await supabase.from("edoscentreadmin_subscriptions").update({ status: target }).eq("id", sub.id);
      subscriptionsUpdated++;
      const websiteName = sub.edoscentreadmin_websites?.name ?? "Website";
      for (const recipientId of recipientIds) {
        notifications.push({
          recipient_id: recipientId,
          type: "subscription_status",
          severity: target === "overdue" ? "critical" : target === "grace_period" ? "warning" : "info",
          title: `Subscription ${target.replace("_", " ")} — ${websiteName}`,
          message: `Renewal date was ${sub.renewal_date}.`,
          link: "/admin/subscriptions",
          dedup_key: `subscription:${sub.id}:${target}`,
        });
      }
      await logAudit({ actorId: null, action: "subscription_auto_status", websiteId: sub.website_id, metadata: { subscription_id: sub.id, status: target } });
    }
  }

  // Reminder emails: one "due soon" notice a few days before due_date, and one
  // "overdue" notice exactly when an invoice crosses its due date. reminder_sent_at/
  // overdue_notice_sent_at gate each so re-running the sweep never re-sends either.
  const reminderCutoff = new Date(today);
  reminderCutoff.setDate(reminderCutoff.getDate() + REMINDER_DAYS_BEFORE_DUE);
  const reminderCutoffStr = reminderCutoff.toISOString().slice(0, 10);

  const { data: dueSoonInvoices } = await supabase
    .from("edoscentreadmin_invoices")
    .select("id, invoice_number, due_date, edoscentreadmin_clients(company_name)")
    .in("status", ["sent", "pending"])
    .is("reminder_sent_at", null)
    .gte("due_date", todayStr)
    .lte("due_date", reminderCutoffStr);

  let remindersSent = 0;
  for (const inv of (dueSoonInvoices ?? []) as unknown as InvoiceRow[]) {
    const result = await sendInvoiceStatusEmail(inv.id, "reminder_due_soon");
    await supabase.from("edoscentreadmin_invoices").update({ reminder_sent_at: today.toISOString() }).eq("id", inv.id);
    if (result.sent) {
      remindersSent++;
      await logAudit({ actorId: null, action: "invoice_reminder_emailed", metadata: { invoice_id: inv.id, kind: "due_soon" } });
    }
  }

  const { data: invoices } = await supabase
    .from("edoscentreadmin_invoices")
    .select("id, invoice_number, due_date, edoscentreadmin_clients(company_name)")
    .in("status", ["sent", "pending"])
    .lt("due_date", todayStr);

  for (const inv of (invoices ?? []) as unknown as InvoiceRow[]) {
    await supabase.from("edoscentreadmin_invoices").update({ status: "overdue" }).eq("id", inv.id);
    invoicesUpdated++;
    const clientName = inv.edoscentreadmin_clients?.company_name ?? "Client";
    for (const recipientId of recipientIds) {
      notifications.push({
        recipient_id: recipientId,
        type: "invoice_overdue",
        severity: "critical",
        title: `Invoice overdue — ${inv.invoice_number}`,
        message: `${clientName} — due ${inv.due_date}.`,
        link: "/admin/invoices",
        dedup_key: `invoice:${inv.id}:overdue`,
      });
    }
    const result = await sendInvoiceStatusEmail(inv.id, "reminder_overdue");
    await supabase.from("edoscentreadmin_invoices").update({ overdue_notice_sent_at: today.toISOString() }).eq("id", inv.id);
    if (result.sent) {
      remindersSent++;
      await logAudit({ actorId: null, action: "invoice_reminder_emailed", metadata: { invoice_id: inv.id, kind: "overdue" } });
    }
    await logAudit({ actorId: null, action: "invoice_auto_overdue", metadata: { invoice_id: inv.id } });
  }

  const { data: domains } = await supabase
    .from("edoscentreadmin_domains")
    .select("id, domain_name, expiry_date, edoscentreadmin_websites(name)")
    .eq("status", "active");

  for (const domain of (domains ?? []) as unknown as DomainRow[]) {
    const bucket = expiryBucket(daysUntil(domain.expiry_date, today));
    if (!bucket) continue;
    const websiteName = domain.edoscentreadmin_websites?.name ?? "Website";
    for (const recipientId of recipientIds) {
      notifications.push({
        recipient_id: recipientId,
        type: "domain_expiring",
        severity: bucket === "expired" ? "critical" : bucket === "expiring_7" ? "warning" : "info",
        title: `Domain ${bucket === "expired" ? "expired" : "expiring soon"} — ${domain.domain_name}`,
        message: `${websiteName} — expiry ${domain.expiry_date}.`,
        link: "/admin/hosting",
        dedup_key: `domain:${domain.id}:${bucket}`,
      });
    }
  }

  const { data: certs } = await supabase
    .from("edoscentreadmin_ssl_certificates")
    .select("id, provider, expiry_date, edoscentreadmin_websites(name)")
    .eq("status", "active");

  for (const cert of (certs ?? []) as unknown as SslRow[]) {
    const bucket = expiryBucket(daysUntil(cert.expiry_date, today));
    if (!bucket) continue;
    const websiteName = cert.edoscentreadmin_websites?.name ?? "Website";
    for (const recipientId of recipientIds) {
      notifications.push({
        recipient_id: recipientId,
        type: "ssl_expiring",
        severity: bucket === "expired" ? "critical" : bucket === "expiring_7" ? "warning" : "info",
        title: `SSL certificate ${bucket === "expired" ? "expired" : "expiring soon"} — ${websiteName}`,
        message: `${cert.provider} — expiry ${cert.expiry_date}.`,
        link: "/admin/hosting",
        dedup_key: `ssl:${cert.id}:${bucket}`,
      });
    }
  }

  // Automatic suspension (migration 028) — only with both switches on. Runs
  // after the overdue pass above, so invoice states are current.
  let suspensionNotices = 0;
  let websitesSuspended = 0;
  if (billing.suspendReady && billing.automation_enabled && billing.auto_suspend) {
    const s = await runAutoSuspend(billing);
    suspensionNotices = s.noticesSent.length;
    websitesSuspended = s.suspended.length;
    const day = todayStr;
    for (const recipientId of recipientIds) {
      for (const n of s.noticesSent) {
        notifications.push({
          recipient_id: recipientId,
          type: "suspension_notice",
          severity: "warning",
          title: `Final notice sent — ${n.website}`,
          message: `${n.invoiceNumber} is unpaid; the site will be suspended if it stays unpaid.`,
          link: "/admin/settings/billing",
          dedup_key: `suspension_notice:${n.invoiceNumber}`,
        });
      }
      for (const n of s.suspended) {
        notifications.push({
          recipient_id: recipientId,
          type: "website_auto_suspended",
          severity: "critical",
          title: `Website suspended — ${n.website}`,
          message: `${n.invoiceNumber} unpaid.${n.emailed ? " The client has been emailed." : " The suspension email could not be sent."} Paying it in full brings the site back.`,
          link: "/admin/websites",
          dedup_key: `website_auto_suspended:${n.invoiceNumber}`,
        });
      }
      for (const n of s.blocked) {
        notifications.push({
          recipient_id: recipientId,
          type: "suspension_blocked",
          severity: "warning",
          title: `Not suspended — ${n.website}`,
          message: `${n.invoiceNumber}: ${n.reason}`,
          link: "/admin/settings/billing",
          dedup_key: `suspension_blocked:${n.invoiceNumber}:${day}`,
        });
      }
    }
  }

  let notificationsCreated = 0;
  if (notifications.length > 0) {
    const { data, error } = await supabase
      .from("edoscentreadmin_notifications")
      .upsert(notifications, { onConflict: "recipient_id,dedup_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    notificationsCreated = data?.length ?? 0;
  }

  return {
    subscriptionsUpdated,
    invoicesUpdated,
    remindersSent,
    renewalInvoicesCreated,
    suspensionNotices,
    websitesSuspended,
    notificationsCreated,
    checkedAt: today.toISOString(),
  };
}
