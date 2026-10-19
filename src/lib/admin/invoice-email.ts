import "server-only";
import { Resend } from "resend";
import { getInvoiceForDocument, type InvoiceForDocument } from "@/lib/admin/queries";
import { getSiteSettings } from "@/lib/queries";
import { absoluteUrl } from "@/lib/seo";
import { formatDate } from "@/lib/utils";
import { createServiceClient } from "@/lib/supabase/server";
import { getBillingSettings, logBillingEmail, paymentLines, type BillingSettings } from "@/lib/admin/billing-settings";
import { renderInvoicePdf } from "@/lib/admin/invoice-pdf";

/**
 * Client emails about an invoice: a new invoice, the due-soon and overdue
 * reminders, and the receipt when it is paid.
 *
 * Laid out the way EDOS Poa's billing emails are — the EDOS logo, a headline,
 * one sentence saying what this is, a table of the facts, one button, how to
 * pay, and EDOS Centre's contacts — with a plain-text part, a reply-to that
 * reaches a person, and the invoice attached as a PDF. Every send, skip and
 * failure is written to the billing email log on the admin page.
 *
 * When each email goes out is decided by the callers, unchanged: the manual
 * "Email" button, the payment cascade, and the daily sweep.
 */

export type InvoiceEmailKind = "view" | "new_invoice" | "payment_received" | "reminder_due_soon" | "reminder_overdue";

const FALLBACK = {
  email: "info@edoscentre.co.ke",
  phone: "+254 721 201 287",
  location: "Marsabit Plaza, 1st Floor, Ngong Rd, Nairobi",
};

function money(n: number, currency: string) {
  return `${currency} ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function subjectFor(kind: InvoiceEmailKind, invoice: InvoiceForDocument): string {
  const amount = money(invoice.total, invoice.currency);
  switch (kind) {
    case "payment_received":
      return `Payment received — Invoice ${invoice.invoice_number} (${amount})`;
    case "reminder_due_soon":
      return `Reminder: Invoice ${invoice.invoice_number} due ${formatDate(invoice.due_date)}`;
    case "reminder_overdue":
      return `Overdue: Invoice ${invoice.invoice_number} (${amount})`;
    default:
      return `Invoice ${invoice.invoice_number} from Edos Centre — ${amount}`;
  }
}

interface Message {
  headline: string;
  lead: string;
  rows: [string, string][];
  pay: string[] | null;
  cta: string;
}

function compose(
  kind: InvoiceEmailKind,
  invoice: InvoiceForDocument,
  paid: number,
  paidOn: string,
  settings: BillingSettings,
): Message {
  const client = invoice.edoscentreadmin_clients;
  const website = invoice.edoscentreadmin_websites?.name ?? null;
  const total = money(invoice.total, invoice.currency);
  const balance = money(Math.max(0, invoice.total - paid), invoice.currency);
  const due = formatDate(invoice.due_date);
  const name = client?.contact_person || client?.company_name || "there";

  const headline =
    kind === "payment_received"
      ? "Payment received — thank you"
      : kind === "reminder_due_soon"
        ? `Due ${due}`
        : kind === "reminder_overdue"
          ? `${balance} overdue`
          : `Invoice ${invoice.invoice_number}`;

  const lead =
    kind === "payment_received"
      ? `Hi ${name}, we've received your payment for invoice ${invoice.invoice_number}. A copy marked paid is attached for your records.`
      : kind === "reminder_due_soon"
        ? `Hi ${name}, a friendly reminder that invoice ${invoice.invoice_number}${website ? ` for ${website}` : ""} is due on ${due}. Paying before then keeps everything running without interruption.`
        : kind === "reminder_overdue"
          ? `Hi ${name}, invoice ${invoice.invoice_number}${website ? ` for ${website}` : ""} was due on ${due} and is still open. Please arrange payment at your earliest convenience — if you've already paid, reply with the reference and we'll match it.`
          : `Hi ${name}, here is invoice ${invoice.invoice_number} from Edos Centre${website ? ` for ${website}` : ""}, due on ${due}.`;

  const rows: [string, string][] = [["Invoice", invoice.invoice_number]];
  if (website) rows.push(["Website", website]);
  if (invoice.notes) rows.push(["For", invoice.notes]);
  rows.push(["Total", total]);
  if (kind === "payment_received") {
    rows.push(["Paid on", formatDate(paidOn)]);
  } else {
    if (paid > 0) rows.push(["Paid so far", money(paid, invoice.currency)]);
    rows.push(["Balance due", balance], ["Due date", due]);
  }

  return {
    headline,
    lead,
    rows,
    pay: kind === "payment_received" ? null : paymentLines(settings, invoice.invoice_number),
    cta: kind === "payment_received" ? "View receipt" : "View invoice",
  };
}

function html(m: Message, viewUrl: string, logoUrl: string, footer: string, accent: string): string {
  const rows = m.rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:10px 16px 10px 0;font-size:14px;color:#5b625d;white-space:nowrap;vertical-align:top;${i ? "border-top:1px solid #e2e6e2;" : ""}">${esc(k)}</td><td style="padding:10px 0;font-size:14px;text-align:right;font-weight:700;${i ? "border-top:1px solid #e2e6e2;" : ""}">${esc(v)}</td></tr>`,
    )
    .join("");
  const pay = m.pay
    ? `<div style="margin:20px 0 0;padding:14px 16px;background:#f4f6f4;border-radius:10px;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.04em;color:#5b625d;">HOW TO PAY</p>
          ${m.pay.map((l) => `<p style="margin:0 0 4px;font-size:14px;line-height:1.5;color:#171a19;">${esc(l)}</p>`).join("")}
        </div>`
    : "";
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171a19;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e6e2;">
      <tr><td style="padding:26px 28px 6px;">
        <img src="${esc(logoUrl)}" alt="EDOS Centre" height="40" style="display:block;height:40px;width:auto;border:0;" />
        <h1 style="margin:18px 0 0;font-size:22px;line-height:1.3;color:#171a19;">${esc(m.headline)}</h1>
      </td></tr>
      <tr><td style="padding:10px 28px 4px;">
        <p style="margin:0;font-size:15px;line-height:1.6;">${esc(m.lead)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0 0;border-top:1px solid #e2e6e2;">${rows}</table>
        ${pay}
        <p style="margin:22px 0 0;">
          <a href="${esc(viewUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:8px;">${esc(m.cta)}</a>
        </p>
        <p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:#5b625d;">The invoice is attached as a PDF, and the button opens it online to print or save.</p>
      </td></tr>
      <tr><td style="padding:18px 28px 26px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#5b625d;border-top:1px solid #e2e6e2;padding-top:14px;">${esc(footer)}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

function text(m: Message, viewUrl: string, footer: string): string {
  const width = Math.max(...m.rows.map(([k]) => k.length)) + 3;
  return [
    m.headline,
    "",
    m.lead,
    "",
    ...m.rows.map(([k, v]) => `${k.padEnd(width)}${v}`),
    ...(m.pay ? ["", "How to pay", ...m.pay] : []),
    "",
    `${m.cta}: ${viewUrl}`,
    "",
    footer,
  ].join("\n");
}

/** Subject, HTML and plain text for one email — pure, so it can be previewed and checked without sending. */
export function invoiceEmailContent(args: {
  kind: InvoiceEmailKind;
  invoice: InvoiceForDocument;
  paid: number;
  paidOn: string;
  settings: BillingSettings;
  viewUrl: string;
  logoUrl: string;
  footer: string;
}) {
  const message = compose(args.kind, args.invoice, args.paid, args.paidOn, args.settings);
  return {
    subject: subjectFor(args.kind, args.invoice),
    html: html(message, args.viewUrl, args.logoUrl, args.footer, "#0b7a44"),
    text: text(message, args.viewUrl, args.footer),
  };
}

/**
 * Core send used by the manual "Email invoice" admin action, the automatic
 * payment-received email (billing-cascade.ts), the reminders and the new
 * renewal invoices (automation.ts). Never throws for missing config or a
 * missing client email in automated contexts — callers pass `throwOnSkip`
 * only for the manual, user-initiated send where silent failure would be
 * confusing. `testTo` sends the real email to someone else, for the admin's
 * "Send me a test" button, and is logged as a test.
 */
export async function sendInvoiceStatusEmail(
  invoiceId: string,
  kind: InvoiceEmailKind,
  opts: { throwOnSkip?: boolean; paidOn?: string; testTo?: string } = {},
): Promise<{ sent: boolean; reason?: string }> {
  const skip = async (reason: string, invoiceNumber: string | null, recipient: string | null, status: "skipped" | "failed" = "skipped") => {
    await logBillingEmail({ invoice_id: invoiceNumber ? invoiceId : null, invoice_number: invoiceNumber, kind, recipient, status, reason, is_test: Boolean(opts.testTo) });
    if (opts.throwOnSkip) throw new Error(reason);
    return { sent: false, reason };
  };

  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !fromEmail) return skip("Email isn't configured — set RESEND_API_KEY and RESEND_FROM_EMAIL.", null, null);

  const invoice = await getInvoiceForDocument(invoiceId);
  if (!invoice) return skip("Invoice not found.", null, null);

  const client = invoice.edoscentreadmin_clients;
  const to = opts.testTo ?? client?.email ?? null;
  if (!to) return skip(`${client?.company_name ?? "This client"} has no email on file.`, invoice.invoice_number, null);

  const [site, billing, supabase] = await Promise.all([getSiteSettings(), getBillingSettings(), createServiceClient()]);
  const { data: payments } = await supabase
    .from("edoscentreadmin_payments")
    .select("amount, payment_date")
    .eq("invoice_id", invoice.id)
    .eq("status", "completed")
    .order("payment_date", { ascending: false });
  const paid = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const paidOn = opts.paidOn ?? payments?.[0]?.payment_date ?? new Date().toISOString().slice(0, 10);

  const contact = {
    email: site.contact_email || FALLBACK.email,
    phone: site.contact_phone || FALLBACK.phone,
    location: site.contact_location || FALLBACK.location,
  };
  const footer = `EDOS Centre · ${contact.email} · ${contact.phone}`;
  const viewUrl = absoluteUrl(`/invoice/${invoice.id}`);
  const content = invoiceEmailContent({
    kind,
    invoice,
    paid,
    paidOn,
    settings: billing,
    viewUrl,
    logoUrl: absoluteUrl("/EDOS-LOGOty-1.png"),
    footer,
  });

  const attachments: { filename: string; content: string }[] = [];
  if (billing.attach_pdf) {
    try {
      const overdue = invoice.status === "overdue" || (invoice.status !== "paid" && invoice.due_date < new Date().toISOString().slice(0, 10));
      const pdf = renderInvoicePdf({
        number: invoice.invoice_number,
        issueDate: formatDate(invoice.issue_date),
        dueDate: formatDate(invoice.due_date),
        status: invoice.status === "paid" || kind === "payment_received" ? "paid" : overdue ? "overdue" : "due",
        paidOn: formatDate(paidOn),
        sellerName: "EDOS Centre",
        sellerLines: [contact.location, contact.phone, contact.email, billing.kra_pin ? `KRA PIN ${billing.kra_pin}` : ""].filter(Boolean),
        buyerName: client?.company_name ?? "—",
        buyerLines: [client?.contact_person, client?.address, client?.email, client?.phone].filter((v): v is string => Boolean(v)),
        line: invoice.notes || "Professional services",
        detail: invoice.edoscentreadmin_websites?.name ?? null,
        currency: invoice.currency,
        amount: Number(invoice.amount),
        tax: Number(invoice.tax),
        discount: Number(invoice.discount),
        total: Number(invoice.total),
        paid,
        paymentLines: paymentLines(billing, invoice.invoice_number),
        footer: `${footer}${billing.kra_pin ? ` · KRA PIN ${billing.kra_pin}` : ""}`,
      });
      attachments.push({ filename: `${invoice.invoice_number}.pdf`, content: Buffer.from(pdf).toString("base64") });
    } catch (err) {
      // The email still carries the link to the invoice; a PDF that failed to build must not stop it.
      console.error("[invoice-email] PDF failed:", err);
    }
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `Edos Centre <${fromEmail}>`,
      to,
      subject: `${opts.testTo ? "[TEST] " : ""}${content.subject}`,
      html: content.html,
      text: content.text,
      ...(billing.reply_to_email ? { replyTo: billing.reply_to_email } : {}),
      ...(billing.bcc_email && !opts.testTo ? { bcc: billing.bcc_email } : {}),
      ...(attachments.length ? { attachments } : {}),
    });
    if (error) return skip(error.message, invoice.invoice_number, to, "failed");
  } catch (err) {
    return skip(err instanceof Error ? err.message : "Could not send the email.", invoice.invoice_number, to, "failed");
  }

  await logBillingEmail({ invoice_id: invoice.id, invoice_number: invoice.invoice_number, kind, recipient: to, status: "sent", is_test: Boolean(opts.testTo) });
  return { sent: true };
}
