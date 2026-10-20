"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { logAudit } from "@/lib/admin/audit";
import { formBool } from "@/components/admin/ui/Checkbox";
import { createServiceClient } from "@/lib/supabase/server";
import { getBillingSettings } from "@/lib/admin/billing-settings";
import { runAutomationSweep } from "@/lib/admin/automation";
import { sendInvoiceStatusEmail, type InvoiceEmailKind } from "@/lib/admin/invoice-email";
import { createRenewalInvoice, findRenewals } from "@/lib/admin/renewal-invoices";

/**
 * The Billing automation page's actions. All of them need an active admin with
 * access to the EDOS Centre site — the same guard the invoice actions use.
 */

const PAGE = "/admin/billing-automation";

/**
 * What each action returns. Errors come back as a value rather than being
 * thrown: a production build replaces a thrown server-action error with a
 * generic "An error occurred in the Server Components render", which is what
 * "Invoice now" showed instead of "Already invoiced — INV-…".
 */
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

async function attempt<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false, error: message === "UNAUTHORIZED" ? "Your session has ended — sign in again." : message };
  }
}


const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v ? v : null));

const settingsSchema = z.object({
  renewal_days_before: z.coerce.number().int().min(1, "At least 1 day.").max(60, "At most 60 days."),
  mpesa_paybill: text(20),
  mpesa_account: text(40),
  mpesa_till: text(20),
  bank_name: text(80),
  bank_account: text(40),
  bank_holder: text(120),
  bank_branch: text(80),
  kra_pin: text(20),
  payment_note: text(300),
  reply_to_email: z.union([z.literal(""), z.email("Reply-to must be an email address.")]).transform((v) => v || null),
  bcc_email: z.union([z.literal(""), z.email("Copy-to must be an email address.")]).transform((v) => v || null),
});

const noticeDaysSchema = z.coerce.number().int().min(1, "At least 1 day of notice.").max(30, "At most 30 days of notice.");
const messageSchema = z
  .string()
  .trim()
  .min(1, "Write the message the client's site shows while suspended.")
  .max(300, "Keep the suspension message under 300 characters.");

const vatRateSchema = z.coerce.number().min(0, "VAT cannot be negative.").max(100, "VAT is a percentage, at most 100.");

async function requireMigrated() {
  const settings = await getBillingSettings();
  if (!settings.migrated) {
    throw new Error("Run supabase/migrations/026_billing_automation.sql first — the settings table is not there yet.");
  }
  return settings;
}

async function saveBillingSettingsImpl(formData: FormData) {
  const admin = await requireAdmin("edos-centre");
  const before = await requireMigrated();
  const fields = settingsSchema.parse(Object.fromEntries(formData));
  const patch = {
    ...fields,
    automation_enabled: formBool(formData, "automation_enabled"),
    renewal_invoices: formBool(formData, "renewal_invoices"),
    auto_send_invoices: formBool(formData, "auto_send_invoices"),
    attach_pdf: formBool(formData, "attach_pdf"),
    // VAT columns arrive with migration 027; until then they are left out.
    ...(before.vatReady
      ? {
          vat_enabled: formBool(formData, "vat_enabled"),
          vat_rate: vatRateSchema.parse(formData.get("vat_rate") ?? 16),
          prices_include_vat: formBool(formData, "prices_include_vat"),
        }
      : {}),
    // Suspension columns arrive with migration 028.
    ...(before.suspendReady
      ? {
          auto_suspend: formBool(formData, "auto_suspend"),
          suspension_notice_days: noticeDaysSchema.parse(formData.get("suspension_notice_days") ?? 3),
          suspension_message: messageSchema.parse(formData.get("suspension_message") ?? ""),
        }
      : {}),
    updated_at: new Date().toISOString(),
    updated_by: admin.id,
  };

  const supabase = await createServiceClient();
  const { error } = await supabase.from("edoscentreadmin_billing_settings").update(patch).eq("id", 1);
  if (error) throw new Error(error.message);

  await logAudit({
    actorId: admin.id,
    action: "billing_settings_updated",
    metadata: {
      automation_enabled: { from: before.automation_enabled, to: patch.automation_enabled },
      auto_send_invoices: { from: before.auto_send_invoices, to: patch.auto_send_invoices },
      renewal_days_before: patch.renewal_days_before,
      ...(before.vatReady ? { vat_enabled: { from: before.vat_enabled, to: patch.vat_enabled }, vat_rate: patch.vat_rate } : {}),
      ...(before.suspendReady ? { auto_suspend: { from: before.auto_suspend, to: patch.auto_suspend } } : {}),
    },
  });
  revalidatePath(PAGE);
}

/** The whole daily sweep, now — the same thing the cron runs. */
async function runBillingSweepNowImpl() {
  const admin = await requireAdmin("edos-centre");
  const result = await runAutomationSweep();
  await logAudit({ actorId: admin.id, action: "billing_sweep_run_manually", metadata: result });
  revalidatePath(PAGE);
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/subscriptions");
  return result;
}

const KINDS: InvoiceEmailKind[] = [
  "new_invoice",
  "reminder_due_soon",
  "reminder_overdue",
  "payment_received",
  "suspension_notice",
  "website_suspended",
];

/** A real invoice's email, sent to the admin instead of the client. */
async function sendTestBillingEmailImpl(invoiceId: string, kind: InvoiceEmailKind) {
  const admin = await requireAdmin("edos-centre");
  if (!KINDS.includes(kind)) throw new Error("Unknown email type.");
  // A test of the final notice shows a date three days out, as a real one would.
  const suspendOn = kind === "suspension_notice" ? new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10) : undefined;
  await sendInvoiceStatusEmail(invoiceId, kind, { throwOnSkip: true, testTo: admin.email, suspendOn });
  revalidatePath(PAGE);
  return admin.email;
}

/** A draft renewal invoice, checked by the admin: marked sent and emailed. */
async function sendDraftInvoiceImpl(invoiceId: string) {
  const admin = await requireAdmin("edos-centre");
  const supabase = await createServiceClient();
  const { data: invoice, error } = await supabase
    .from("edoscentreadmin_invoices")
    .select("id, invoice_number, status")
    .eq("id", invoiceId)
    .single();
  if (error) throw new Error(error.message);
  if (invoice.status !== "draft") throw new Error(`${invoice.invoice_number} is already ${invoice.status}.`);

  // Emailed first: if the email cannot go, the invoice stays a draft and the
  // admin sees why, rather than a "sent" invoice nobody received.
  await sendInvoiceStatusEmail(invoiceId, "new_invoice", { throwOnSkip: true });
  await supabase.from("edoscentreadmin_invoices").update({ status: "sent" }).eq("id", invoiceId);
  await logAudit({ actorId: admin.id, action: "invoice_emailed", metadata: { invoice_number: invoice.invoice_number, renewal: true } });

  revalidatePath(PAGE);
  revalidatePath("/admin/invoices");
}

/** "Invoice now" for one subscription, outside the daily window. */
async function createRenewalInvoiceNowImpl(subscriptionId: string) {
  const admin = await requireAdmin("edos-centre");
  const settings = await requireMigrated();
  const [candidate] = await findRenewals(settings, new Date(), subscriptionId);
  if (!candidate) throw new Error("That subscription has no renewal date, or is suspended, cancelled or expired.");
  if (candidate.skip) throw new Error(candidate.skip);
  const created = await createRenewalInvoice(candidate, settings, admin.id);
  if (!created) throw new Error("This period has just been invoiced.");

  revalidatePath(PAGE);
  revalidatePath("/admin/invoices");
  return created;
}

/** Per-subscription opt-out from automatic suspension. */
async function setSubscriptionAutoSuspendImpl(subscriptionId: string, on: boolean) {
  const admin = await requireAdmin("edos-centre");
  const settings = await requireMigrated();
  if (!settings.suspendReady) throw new Error("Run supabase/migrations/028_auto_suspend.sql first.");
  const supabase = await createServiceClient();
  const { error } = await supabase.from("edoscentreadmin_subscriptions").update({ auto_suspend: on }).eq("id", subscriptionId);
  if (error) throw new Error(error.message);
  await logAudit({ actorId: admin.id, action: "subscription_auto_suspend_set", metadata: { subscription_id: subscriptionId, on } });
  revalidatePath(PAGE);
}

/** Per-subscription opt-out from automatic invoices. */
async function setSubscriptionAutoInvoiceImpl(subscriptionId: string, on: boolean) {
  const admin = await requireAdmin("edos-centre");
  await requireMigrated();
  const supabase = await createServiceClient();
  const { error } = await supabase.from("edoscentreadmin_subscriptions").update({ auto_invoice: on }).eq("id", subscriptionId);
  if (error) throw new Error(error.message);
  await logAudit({ actorId: admin.id, action: "subscription_auto_invoice_set", metadata: { subscription_id: subscriptionId, on } });
  revalidatePath(PAGE);
}

// ── The actions, as the page calls them ──────────────────────────────────────

export async function saveBillingSettings(formData: FormData) {
  return attempt(() => saveBillingSettingsImpl(formData));
}

export async function runBillingSweepNow() {
  return attempt(() => runBillingSweepNowImpl());
}

export async function sendTestBillingEmail(invoiceId: string, kind: InvoiceEmailKind) {
  return attempt(() => sendTestBillingEmailImpl(invoiceId, kind));
}

export async function sendDraftInvoice(invoiceId: string) {
  return attempt(() => sendDraftInvoiceImpl(invoiceId));
}

export async function createRenewalInvoiceNow(subscriptionId: string) {
  return attempt(() => createRenewalInvoiceNowImpl(subscriptionId));
}

export async function setSubscriptionAutoInvoice(subscriptionId: string, on: boolean) {
  return attempt(() => setSubscriptionAutoInvoiceImpl(subscriptionId, on));
}

export async function setSubscriptionAutoSuspend(subscriptionId: string, on: boolean) {
  return attempt(() => setSubscriptionAutoSuspendImpl(subscriptionId, on));
}
