import { getBillingSettings } from "@/lib/admin/billing-settings";
import { findRenewals } from "@/lib/admin/renewal-invoices";
import { findSuspensions } from "@/lib/admin/auto-suspend";
import { createServiceClient } from "@/lib/supabase/server";
import BillingAutomationManager from "@/components/admin/billing/BillingAutomationManager";

export const metadata = { title: "Billing & email — Settings — EDOS Control Centre" };
export const dynamic = "force-dynamic";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default async function BillingAutomationPage() {
  const settings = await getBillingSettings();
  const supabase = await createServiceClient();
  const today = new Date();
  const todayStr = iso(today);
  const in3 = iso(new Date(today.getTime() + 3 * 86_400_000));

  // What the sweep would do today, without doing it.
  const renewals = settings.migrated ? await findRenewals(settings, today).catch(() => []) : [];
  const suspensions = settings.suspendReady ? await findSuspensions(settings, today).catch(() => []) : [];

  const [dueSoon, overdue, drafts, subs, log, recent] = await Promise.all([
    supabase
      .from("edoscentreadmin_invoices")
      .select("id, invoice_number, due_date, total, currency, edoscentreadmin_clients(company_name, email)")
      .in("status", ["sent", "pending"])
      .is("reminder_sent_at", null)
      .gte("due_date", todayStr)
      .lte("due_date", in3),
    supabase
      .from("edoscentreadmin_invoices")
      .select("id, invoice_number, due_date, total, currency, edoscentreadmin_clients(company_name, email)")
      .in("status", ["sent", "pending"])
      .lt("due_date", todayStr),
    settings.migrated
      ? supabase
          .from("edoscentreadmin_invoices")
          .select("id, invoice_number, due_date, total, currency, notes, edoscentreadmin_clients(company_name, email)")
          .eq("status", "draft")
          .not("renewal_period_start", "is", null)
          .order("due_date")
      : Promise.resolve({ data: [] }),
    supabase
      .from("edoscentreadmin_subscriptions")
      .select(
        `id, status, renewal_date, amount, currency, billing_cycle, auto_renew, grace_period_days${settings.migrated ? ", auto_invoice" : ""}${settings.suspendReady ? ", auto_suspend" : ""}, edoscentreadmin_websites(name), edoscentreadmin_clients(company_name, email)`,
      )
      .not("status", "in", "(cancelled,expired)")
      .order("renewal_date"),
    settings.migrated
      ? supabase.from("edoscentreadmin_billing_email_log").select("*").order("created_at", { ascending: false }).limit(60)
      : Promise.resolve({ data: [] }),
    supabase
      .from("edoscentreadmin_invoices")
      .select("id, invoice_number, status, edoscentreadmin_clients(company_name)")
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  return (
    <BillingAutomationManager
      settings={settings}
      cronConfigured={Boolean(process.env.CRON_SECRET)}
      emailConfigured={Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL)}
      renewals={renewals}
      suspensions={suspensions}
      dueSoon={(dueSoon.data ?? []) as unknown as InvoiceLite[]}
      overdue={(overdue.data ?? []) as unknown as InvoiceLite[]}
      drafts={(drafts.data ?? []) as unknown as InvoiceLite[]}
      subscriptions={(subs.data ?? []) as unknown as SubscriptionLite[]}
      log={(log.data ?? []) as unknown as LogRow[]}
      recentInvoices={(recent.data ?? []) as unknown as RecentInvoice[]}
    />
  );
}

export type InvoiceLite = {
  id: string;
  invoice_number: string;
  due_date: string;
  total: number;
  currency: string;
  notes?: string | null;
  edoscentreadmin_clients: { company_name: string; email: string | null } | null;
};

export type SubscriptionLite = {
  id: string;
  status: string;
  renewal_date: string | null;
  amount: number;
  currency: string;
  billing_cycle: string;
  auto_renew: boolean;
  auto_invoice?: boolean;
  auto_suspend?: boolean;
  grace_period_days?: number;
  edoscentreadmin_websites: { name: string } | null;
  edoscentreadmin_clients: { company_name: string; email: string | null } | null;
};

export type LogRow = {
  id: string;
  invoice_number: string | null;
  kind: string;
  recipient: string | null;
  status: string;
  reason: string | null;
  is_test: boolean;
  created_at: string;
};

export type RecentInvoice = {
  id: string;
  invoice_number: string;
  status: string;
  edoscentreadmin_clients: { company_name: string } | null;
};
