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

async function requireMigrated() {
  const settings = await getBillingSettings();
  if (!settings.migrated) {
    throw new Error("Run supabase/migrations/026_billing_automation.sql first — the settings table is not there yet.");
  }
  return settings;
}

export async function saveBillingSettings(formData: FormData) {
  const admin = await requireAdmin("edos-centre");
  const before = await requireMigrated();
  const fields = settingsSchema.parse(Object.fromEntries(formData));
  const patch = {
    ...fields,
    automation_enabled: formBool(formData, "automation_enabled"),
    renewal_invoices: formBool(formData, "renewal_invoices"),
    auto_send_invoices: formBool(formData, "auto_send_invoices"),
    attach_pdf: formBool(formData, "attach_pdf"),
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
    },
  });
  revalidatePath(PAGE);
}

/** The whole daily sweep, now — the same thing the cron runs. */
export async function runBillingSweepNow() {
  const admin = await requireAdmin("edos-centre");
  const result = await runAutomationSweep();
  await logAudit({ actorId: admin.id, action: "billing_sweep_run_manually", metadata: result });
  revalidatePath(PAGE);
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/subscriptions");
  return result;
}

const KINDS: InvoiceEmailKind[] = ["new_invoice", "reminder_due_soon", "reminder_overdue", "payment_received"];

/** A real invoice's email, sent to the admin instead of the client. */
export async function sendTestBillingEmail(invoiceId: string, kind: InvoiceEmailKind) {
  const admin = await requireAdmin("edos-centre");
  if (!KINDS.includes(kind)) throw new Error("Unknown email type.");
  await sendInvoiceStatusEmail(invoiceId, kind, { throwOnSkip: true, testTo: admin.email });
  revalidatePath(PAGE);
  return admin.email;
}

/** A draft renewal invoice, checked by the admin: marked sent and emailed. */
export async function sendDraftInvoice(invoiceId: string) {
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
export async function createRenewalInvoiceNow(subscriptionId: string) {
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

/** Per-subscription opt-out from automatic invoices. */
export async function setSubscriptionAutoInvoice(subscriptionId: string, on: boolean) {
  const admin = await requireAdmin("edos-centre");
  await requireMigrated();
  const supabase = await createServiceClient();
  const { error } = await supabase.from("edoscentreadmin_subscriptions").update({ auto_invoice: on }).eq("id", subscriptionId);
  if (error) throw new Error(error.message);
  await logAudit({ actorId: admin.id, action: "subscription_auto_invoice_set", metadata: { subscription_id: subscriptionId, on } });
  revalidatePath(PAGE);
}
