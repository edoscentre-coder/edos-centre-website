import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/admin/audit";
import { sendInvoiceStatusEmail } from "@/lib/admin/invoice-email";
import type { BillingSettings } from "@/lib/admin/billing-settings";
import { formatDate } from "@/lib/utils";
import { vatSplit } from "@/lib/admin/vat";

/**
 * Renewal invoices: the next period's invoice for a subscription, made a set
 * number of days before its renewal date and due on that date.
 *
 * Paying one is the existing path, unchanged — billing-cascade.ts sees the
 * subscription_id, moves the renewal date on by one cycle and reactivates a
 * suspended website. This only creates the invoice that path was waiting for.
 *
 * One invoice per subscription per period, twice over: the period's start is
 * stored on the invoice behind a unique index (migration 026), and before
 * creating one this looks for an invoice an admin already raised by hand for
 * the same subscription around the same date — so switching this on for a
 * shop that has been invoicing manually does not bill anyone twice.
 */

const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12, custom: 1 };
const DAY = 86_400_000;
/** An invoice due within this many days before the renewal date is taken to cover it. */
const MANUAL_MATCH_DAYS = 14;
/** Renewal dates further back than this are left to the admin rather than invoiced late. */
const LATE_LIMIT_DAYS = 30;

export interface RenewalCandidate {
  subscriptionId: string;
  websiteId: string;
  clientId: string;
  website: string;
  client: string;
  clientEmail: string | null;
  plan: string | null;
  /** The subscription's price, as entered on the subscription. */
  amount: number;
  /** What the invoice will carry: before VAT, the VAT, and the total. */
  net: number;
  tax: number;
  total: number;
  currency: string;
  renewalDate: string;
  periodEnd: string;
  line: string;
  /** Why it will not be invoiced, when it won't. */
  skip: string | null;
}

type SubRow = {
  id: string;
  website_id: string;
  client_id: string;
  billing_cycle: string;
  amount: number;
  currency: string;
  status: string;
  renewal_date: string;
  auto_renew: boolean;
  auto_invoice?: boolean;
  edoscentreadmin_websites: { name: string } | null;
  edoscentreadmin_clients: { company_name: string; email: string | null } | null;
  edoscentreadmin_subscription_plans: { name: string } | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);

function periodEnd(start: string, cycle: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + (CYCLE_MONTHS[cycle] ?? 1));
  d.setUTCDate(d.getUTCDate() - 1);
  return iso(d);
}

/** Subscriptions whose renewal falls inside the window, each with what would happen to it. */
export async function findRenewals(
  settings: BillingSettings & { vatReady?: boolean },
  today = new Date(),
  onlySubscriptionId?: string,
): Promise<RenewalCandidate[]> {
  // VAT only once migration 027 is in and the switch is on.
  const vatOn = Boolean(settings.vatReady && settings.vat_enabled);
  const supabase = await createServiceClient();
  const horizon = iso(new Date(today.getTime() + settings.renewal_days_before * DAY));
  const earliest = iso(new Date(today.getTime() - LATE_LIMIT_DAYS * DAY));

  let query = supabase
    .from("edoscentreadmin_subscriptions")
    .select(
      "id, website_id, client_id, billing_cycle, amount, currency, status, renewal_date, auto_renew, auto_invoice, edoscentreadmin_websites(name), edoscentreadmin_clients(company_name, email), edoscentreadmin_subscription_plans(name)",
    )
    .in("status", ["trial", "active", "due_soon", "grace_period", "overdue"])
    .not("renewal_date", "is", null);
  query = onlySubscriptionId ? query.eq("id", onlySubscriptionId) : query.lte("renewal_date", horizon).gte("renewal_date", earliest);

  const { data: subs, error } = await query.order("renewal_date");
  if (error) throw new Error(error.message);
  const rows = (subs ?? []) as unknown as SubRow[];
  if (!rows.length) return [];

  const { data: invoices } = await supabase
    .from("edoscentreadmin_invoices")
    .select("subscription_id, invoice_number, due_date, status, renewal_period_start")
    .in("subscription_id", rows.map((s) => s.id))
    .neq("status", "cancelled");

  return rows.map((s) => {
    const website = (s.edoscentreadmin_websites?.name ?? "Website").trim();
    const end = periodEnd(s.renewal_date, s.billing_cycle);
    const plan = s.edoscentreadmin_subscription_plans?.name?.trim() || null;
    // "Premium Plan", not "Premium Plan plan".
    const planText = plan ? (/(^|\s)plan$/i.test(plan) ? plan : `${plan} plan`) : "website subscription";
    const line = `${website} — ${planText}, ${formatDate(s.renewal_date)} to ${formatDate(end)}`;

    // An invoice already covers this period when it was made for it (the
    // renewal_period_start this code stores), or when an admin raised one by
    // hand around this renewal date and it is still open. A manual invoice
    // that is already paid and was due before the renewal date paid the
    // period before — paying it is what moved the renewal date on — so it
    // does not stop the next one; one paid and due on or after the renewal
    // date was paid in advance for this period, so it does.
    const matchFrom = iso(new Date(new Date(`${s.renewal_date}T00:00:00Z`).getTime() - MANUAL_MATCH_DAYS * DAY));
    const covering = (invoices ?? []).find((i) => {
      if (i.subscription_id !== s.id) return false;
      if (i.renewal_period_start) return i.renewal_period_start === s.renewal_date;
      if (i.due_date < matchFrom) return false;
      return i.status === "paid" ? i.due_date >= s.renewal_date : true;
    });

    let skip: string | null = null;
    if (covering) skip = `Already invoiced — ${covering.invoice_number}`;
    else if (!s.auto_renew) skip = "Auto-renew is off for this subscription";
    else if (s.auto_invoice === false) skip = "Automatic invoices are off for this subscription";
    else if (!(Number(s.amount) > 0)) skip = "Subscription amount is zero";

    const { amount: net, tax } = vatOn
      ? vatSplit(Number(s.amount), Number(settings.vat_rate), settings.prices_include_vat)
      : { amount: Number(s.amount), tax: 0 };

    return {
      subscriptionId: s.id,
      websiteId: s.website_id,
      clientId: s.client_id,
      website,
      client: (s.edoscentreadmin_clients?.company_name ?? "Client").trim(),
      clientEmail: s.edoscentreadmin_clients?.email ?? null,
      plan,
      amount: Number(s.amount),
      net,
      tax,
      total: Math.round((net + tax) * 100) / 100,
      currency: s.currency,
      renewalDate: s.renewal_date,
      periodEnd: end,
      line,
      skip,
    };
  });
}

export interface CreatedRenewal {
  subscriptionId: string;
  invoiceId: string;
  invoiceNumber: string;
  website: string;
  client: string;
  status: "draft" | "sent";
  emailed: boolean;
  emailNote?: string;
}

/** Create the invoice for one candidate. Returns null when another run got there first. */
export async function createRenewalInvoice(
  c: RenewalCandidate,
  settings: BillingSettings,
  actorId: string | null,
  sendNow = settings.auto_send_invoices,
): Promise<CreatedRenewal | null> {
  const supabase = await createServiceClient();
  const { data: number, error: numberError } = await supabase.rpc("edoscentreadmin_next_invoice_number");
  if (numberError || !number) throw new Error(numberError?.message ?? "Could not get an invoice number.");

  const status = sendNow ? "sent" : "draft";
  const today = iso(new Date());
  const { data: invoice, error } = await supabase
    .from("edoscentreadmin_invoices")
    .insert({
      invoice_number: number,
      client_id: c.clientId,
      website_id: c.websiteId,
      subscription_id: c.subscriptionId,
      issue_date: today,
      due_date: c.renewalDate < today ? today : c.renewalDate,
      amount: c.net,
      tax: c.tax,
      discount: 0,
      total: c.total,
      currency: c.currency,
      status,
      notes: c.line,
      renewal_period_start: c.renewalDate,
    })
    .select("id")
    .single();
  if (error) {
    // The unique index: this period was invoiced by an overlapping run.
    if (error.code === "23505") return null;
    throw new Error(error.message);
  }

  await logAudit({
    actorId,
    action: "renewal_invoice_created",
    websiteId: c.websiteId,
    metadata: { invoice_number: number, subscription_id: c.subscriptionId, period: `${c.renewalDate}..${c.periodEnd}`, status },
  });

  const created: CreatedRenewal = {
    subscriptionId: c.subscriptionId,
    invoiceId: invoice.id,
    invoiceNumber: number,
    website: c.website,
    client: c.client,
    status,
    emailed: false,
  };

  if (sendNow) {
    const result = await sendInvoiceStatusEmail(invoice.id, "new_invoice");
    created.emailed = result.sent;
    if (!result.sent) created.emailNote = result.reason;
    // The new-invoice email has just told them the due date; the daily
    // due-soon reminder should not repeat it the same week.
    const daysToDue = Math.ceil((new Date(c.renewalDate).getTime() - Date.now()) / DAY);
    if (daysToDue <= 3) {
      await supabase.from("edoscentreadmin_invoices").update({ reminder_sent_at: new Date().toISOString() }).eq("id", invoice.id);
    }
  }
  return created;
}

/** The sweep's step: every due candidate in the window, invoiced once. */
export async function createDueRenewalInvoices(settings: BillingSettings & { vatReady?: boolean }): Promise<CreatedRenewal[]> {
  const created: CreatedRenewal[] = [];
  for (const c of await findRenewals(settings)) {
    if (c.skip) continue;
    try {
      const r = await createRenewalInvoice(c, settings, null);
      if (r) created.push(r);
    } catch (err) {
      console.error("[renewal-invoices] could not invoice", c.subscriptionId, err);
    }
  }
  return created;
}
