import "server-only";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type BillingSettings = Database["public"]["Tables"]["edoscentreadmin_billing_settings"]["Row"];

/**
 * EDOS Centre's payment details as EDOS Poa's platform account holds them —
 * the same paybill, account and bank on every EDOS invoice, whichever system
 * issued it. Used until migration 026 has been run, and as the seed for the
 * settings row it creates; after that the admin page is the place to change
 * them.
 */
export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  id: 1,
  automation_enabled: false,
  renewal_invoices: true,
  renewal_days_before: 7,
  auto_send_invoices: false,
  mpesa_paybill: "600100",
  mpesa_account: "188110",
  mpesa_till: null,
  bank_name: "Stanbic Bank Kenya",
  bank_account: "0100018818811",
  bank_holder: "EMBRACE DATA FOR OPTIMUM SOLUTIONS CENTRE LIMITED",
  bank_branch: "Kisumu",
  kra_pin: "P052570047Z",
  payment_note: null,
  reply_to_email: "info@edoscentre.co.ke",
  bcc_email: null,
  attach_pdf: true,
  vat_enabled: false,
  vat_rate: 16,
  prices_include_vat: false,
  updated_at: new Date(0).toISOString(),
  updated_by: null,
};

/**
 * The settings row, or the defaults above when migration 026 has not been run —
 * automation stays off either way. `vatReady` says whether migration 027 has
 * added the VAT columns; until it has, VAT stays off and is not saved.
 */
export async function getBillingSettings(): Promise<BillingSettings & { migrated: boolean; vatReady: boolean }> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase.from("edoscentreadmin_billing_settings").select("*").eq("id", 1).maybeSingle();
  if (error || !data) return { ...DEFAULT_BILLING_SETTINGS, migrated: false, vatReady: false };
  const vatReady = "vat_enabled" in data;
  return {
    ...DEFAULT_BILLING_SETTINGS,
    ...data,
    vat_rate: Number(data.vat_rate ?? DEFAULT_BILLING_SETTINGS.vat_rate),
    migrated: true,
    vatReady,
  };
}

/** Payment details as lines, for the email, the PDF and the plain-text part alike. */
export function paymentLines(s: BillingSettings, invoiceNumber: string): string[] {
  const lines: string[] = [];
  if (s.mpesa_paybill) {
    lines.push(`M-Pesa Paybill ${s.mpesa_paybill}, account ${s.mpesa_account || invoiceNumber}`);
  }
  if (s.mpesa_till) lines.push(`M-Pesa Till ${s.mpesa_till}`);
  if (s.bank_name && s.bank_account) {
    lines.push(
      `${s.bank_name}${s.bank_branch ? `, ${s.bank_branch}` : ""} — account ${s.bank_account}${s.bank_holder ? ` (${s.bank_holder})` : ""}`,
    );
  }
  lines.push(`Please quote invoice ${invoiceNumber} as the reference.`);
  if (s.payment_note) lines.push(s.payment_note);
  return lines;
}

/** Written to the email log; never throws — a log that cannot be written must not stop an email or a sweep. */
export async function logBillingEmail(entry: {
  invoice_id: string | null;
  invoice_number: string | null;
  kind: string;
  recipient: string | null;
  status: "sent" | "skipped" | "failed";
  reason?: string | null;
  is_test?: boolean;
}) {
  try {
    const supabase = await createServiceClient();
    await supabase.from("edoscentreadmin_billing_email_log").insert({ ...entry, reason: entry.reason ?? null });
  } catch {
    // Table not there yet (migration 026) or a transient error — the email itself is what matters.
  }
}
