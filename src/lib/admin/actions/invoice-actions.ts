"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { logAudit } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { applyPaymentCascade } from "@/lib/admin/billing-cascade";
import { getBillingSettings } from "@/lib/admin/billing-settings";
import { vatSplit } from "@/lib/admin/vat";

const invoiceSchema = z.object({
  client_id: z.string().min(1),
  website_id: z.string().optional(),
  subscription_id: z.string().optional(),
  issue_date: z.string().min(1),
  due_date: z.string().min(1),
  amount: z.coerce.number().min(0),
  tax: z.coerce.number().default(0),
  discount: z.coerce.number().default(0),
  currency: z.string().default("KES"),
  status: z.enum(["draft", "sent", "pending", "paid", "partially_paid", "overdue", "cancelled"]),
  notes: z.string().optional(),
});

export async function upsertInvoice(formData: FormData, id?: string) {
  const admin = await requireAdmin("edos-centre");
  const parsed = invoiceSchema.parse(Object.fromEntries(formData));
  // "Add VAT" ticked: VAT is worked out here from the amount at the rate set
  // under Billing automation, not taken from the browser. Unticked, the tax
  // field is whatever was typed — the form as it always was.
  if (formData.get("apply_vat") === "on") {
    const { vat_rate } = await getBillingSettings();
    parsed.tax = vatSplit(parsed.amount, Number(vat_rate), false).tax;
  }
  const total = Math.round((parsed.amount + parsed.tax - parsed.discount) * 100) / 100;

  const supabase = await createServiceClient();
  const payload = {
    client_id: parsed.client_id,
    website_id: parsed.website_id || null,
    subscription_id: parsed.subscription_id || null,
    issue_date: parsed.issue_date,
    due_date: parsed.due_date,
    amount: parsed.amount,
    tax: parsed.tax,
    discount: parsed.discount,
    total,
    currency: parsed.currency,
    status: parsed.status,
    notes: parsed.notes || null,
  };

  if (id) {
    const { error } = await supabase.from("edoscentreadmin_invoices").update(payload).eq("id", id);
    if (error) throw new Error(error.message);
    await logAudit({ actorId: admin.id, action: "invoice_updated", metadata: { id } });
  } else {
    const { data: invoiceNumber, error: numberError } = await supabase.rpc("edoscentreadmin_next_invoice_number");
    if (numberError) throw new Error(numberError.message);

    const { error } = await supabase.from("edoscentreadmin_invoices").insert({ ...payload, invoice_number: invoiceNumber });
    if (error) throw new Error(error.message);
    await logAudit({ actorId: admin.id, action: "invoice_created", metadata: { invoice_number: invoiceNumber } });
  }

  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
}

export async function deleteInvoice(id: string, invoiceNumber: string) {
  const admin = await requireAdmin("edos-centre");
  const supabase = await createServiceClient();
  const { error } = await supabase.from("edoscentreadmin_invoices").delete().eq("id", id);
  if (error) throw new Error(error.message);

  await logAudit({ actorId: admin.id, action: "invoice_deleted", metadata: { invoice_number: invoiceNumber } });
  revalidatePath("/admin/invoices");
}

const paymentSchema = z.object({
  invoice_id: z.string().min(1),
  amount: z.coerce.number().min(0.01),
  payment_method: z.enum(["mpesa", "bank", "card", "paypal", "cash", "other"]),
  transaction_reference: z.string().optional(),
  payment_date: z.string().min(1),
  notes: z.string().optional(),
});

/**
 * Records a manual payment via the shared cascade (see billing-cascade.ts) — the
 * same logic the M-Pesa callback uses, so a manual entry and an automated M-Pesa
 * payment behave identically. Nothing here fabricates a "paid" state; every
 * transition is derived from the payments actually on file.
 */
export async function recordPayment(formData: FormData) {
  const admin = await requireAdmin("edos-centre");
  const parsed = paymentSchema.parse(Object.fromEntries(formData));

  await applyPaymentCascade({
    invoiceId: parsed.invoice_id,
    amount: parsed.amount,
    paymentMethod: parsed.payment_method,
    transactionReference: parsed.transaction_reference || null,
    paymentDate: parsed.payment_date,
    recordedBy: admin.id,
    actorId: admin.id,
    notes: parsed.notes || null,
  });
}
