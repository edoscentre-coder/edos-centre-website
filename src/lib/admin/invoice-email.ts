import "server-only";
import { Resend } from "resend";
import { getInvoiceForDocument, type InvoiceForDocument } from "@/lib/admin/queries";
import { getSiteSettings } from "@/lib/queries";
import { absoluteUrl } from "@/lib/seo";
import { formatDate } from "@/lib/utils";
import { createServiceClient } from "@/lib/supabase/server";
import { getBillingSettings, logBillingEmail, paymentLines, type BillingSettings } from "@/lib/admin/billing-settings";
import { renderInvoicePdf } from "@/lib/admin/invoice-pdf";
import { vatLabel } from "@/lib/admin/vat";

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

export type InvoiceEmailKind =
  | "view"
  | "new_invoice"
  | "payment_received"
  | "reminder_due_soon"
  | "reminder_overdue"
  /** Final notice before automatic suspension (migration 028). */
  | "suspension_notice"
  /** The website has just been suspended for this invoice. */
  | "website_suspended";

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

function subjectFor(kind: InvoiceEmailKind, invoice: InvoiceForDocument, suspendOn?: string | null): string {
  const amount = money(invoice.total, invoice.currency);
  const site = invoice.edoscentreadmin_websites?.name?.trim() || "your website";
  switch (kind) {
    case "suspension_notice":
      return `Final notice: ${site} will be suspended${suspendOn ? ` on ${formatDate(suspendOn)}` : ""} — Invoice ${invoice.invoice_number}`;
    case "website_suspended":
      return `${site} has been suspended — Invoice ${invoice.invoice_number} (${amount})`;
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
  suspendOn?: string | null,
): Message {
  const client = invoice.edoscentreadmin_clients;
  const website = invoice.edoscentreadmin_websites?.name ?? null;
  const total = money(invoice.total, invoice.currency);
  const balance = money(Math.max(0, invoice.total - paid), invoice.currency);
  const due = formatDate(invoice.due_date);
  const name = client?.contact_person || client?.company_name || "there";

  const when = suspendOn ? formatDate(suspendOn) : "shortly";
  const headline =
    kind === "suspension_notice"
      ? `Suspension on ${when}`
      : kind === "website_suspended"
        ? `${website ?? "Your website"} is suspended`
        : kind === "payment_received"
      ? "Payment received — thank you"
      : kind === "reminder_due_soon"
        ? `Due ${due}`
        : kind === "reminder_overdue"
          ? `${balance} overdue`
          : `Invoice ${invoice.invoice_number}`;

  const lead =
    kind === "suspension_notice"
      ? `Hi ${name}, invoice ${invoice.invoice_number}${website ? ` for ${website}` : ""} was due on ${due} and is still unpaid. If payment isn't received, the website will be suspended on ${when}. Paying before then keeps it online — if you've already paid, reply with the reference and we'll match it.`
      : kind === "website_suspended"
        ? `Hi ${name}, because invoice ${invoice.invoice_number} remains unpaid, ${website ?? "your website"} has been suspended. Nothing has been deleted: as soon as the payment is received the website comes back online automatically.`
        : kind === "payment_received"
      ? `Hi ${name}, we've received your payment for invoice ${invoice.invoice_number}. A copy marked paid is attached for your records.`
      : kind === "reminder_due_soon"
        ? `Hi ${name}, a friendly reminder that invoice ${invoice.invoice_number}${website ? ` for ${website}` : ""} is due on ${due}. Paying before then keeps everything running without interruption.`
        : kind === "reminder_overdue"
          ? `Hi ${name}, invoice ${invoice.invoice_number}${website ? ` for ${website}` : ""} was due on ${due} and is still open. Please arrange payment at your earliest convenience — if you've already paid, reply with the reference and we'll match it.`
          : `Hi ${name}, here is invoice ${invoice.invoice_number} from Edos Centre${website ? ` for ${website}` : ""}, due on ${due}.`;

  const rows: [string, string][] = [["Invoice", invoice.invoice_number]];
  if (website) rows.push(["Website", website]);
  if (invoice.notes) rows.push(["For", invoice.notes]);
  if (Number(invoice.tax) > 0) {
    rows.push(["Subtotal", money(invoice.amount, invoice.currency)]);
    rows.push([vatLabel(Number(invoice.amount), Number(invoice.tax)), money(invoice.tax, invoice.currency)]);
  }
  rows.push(["Total", total]);
  if (kind === "payment_received") {
    rows.push(["Paid on", formatDate(paidOn)]);
  } else {
    if (paid > 0) rows.push(["Paid so far", money(paid, invoice.currency)]);
    rows.push(["Balance due", balance], ["Due date", due]);
    if (kind === "suspension_notice" && suspendOn) rows.push(["Suspension date", formatDate(suspendOn)]);
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

type InvoiceContext = {
  billing: Awaited<ReturnType<typeof getBillingSettings>>;
  paid: number;
  /** The latest payment's date; null when none is recorded (an invoice marked paid by hand). */
  paidOn: string | null;
  contact: { email: string; phone: string; location: string };
  footer: string;
};

/** What the email and the PDF both need beyond the invoice row: settings, payments, EDOS's contacts. */
async function invoiceContext(invoice: InvoiceForDocument, paidOnOverride?: string): Promise<InvoiceContext> {
  const [site, billing, supabase] = await Promise.all([getSiteSettings(), getBillingSettings(), createServiceClient()]);
  const { data: payments } = await supabase
    .from("edoscentreadmin_payments")
    .select("amount, payment_date")
    .eq("invoice_id", invoice.id)
    .eq("status", "completed")
    .order("payment_date", { ascending: false });
  const recorded = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  // An invoice can be marked paid in the form without a payment being
  // recorded against it; it is still paid, so it shows no balance.
  const paid = invoice.status === "paid" ? Math.max(recorded, Number(invoice.total)) : recorded;
  const paidOn = paidOnOverride ?? payments?.[0]?.payment_date ?? null;
  const contact = {
    email: site.contact_email || FALLBACK.email,
    phone: site.contact_phone || FALLBACK.phone,
    location: site.contact_location || FALLBACK.location,
  };
  return { billing, paid, paidOn, contact, footer: `EDOS Centre · ${contact.email} · ${contact.phone}` };
}

/** The invoice PDF — attached to emails, and shown in the admin's invoice window. */
function pdfFromContext(invoice: InvoiceForDocument, ctx: InvoiceContext, markPaid = false): Uint8Array {
  const { billing, paid, paidOn, contact, footer } = ctx;
  const client = invoice.edoscentreadmin_clients;
  const overdue = invoice.status === "overdue" || (invoice.status !== "paid" && invoice.due_date < new Date().toISOString().slice(0, 10));
  return renderInvoicePdf({
    number: invoice.invoice_number,
    issueDate: formatDate(invoice.issue_date),
    dueDate: formatDate(invoice.due_date),
    status: invoice.status === "paid" || markPaid ? "paid" : overdue ? "overdue" : "due",
    paidOn: paidOn ? formatDate(paidOn) : null,
    sellerName: "EDOS Centre",
    sellerLines: [contact.location, contact.phone, contact.email, billing.kra_pin ? `KRA PIN ${billing.kra_pin}` : ""].filter(Boolean),
    buyerName: client?.company_name?.trim() || "—",
    buyerLines: [client?.contact_person, client?.address, client?.email, client?.phone].filter((v): v is string => Boolean(v)),
    line: invoice.notes || "Professional services",
    detail: invoice.edoscentreadmin_websites?.name?.trim() ?? null,
    currency: invoice.currency,
    amount: Number(invoice.amount),
    tax: Number(invoice.tax),
    discount: Number(invoice.discount),
    total: Number(invoice.total),
    paid,
    paymentLines: paymentLines(billing, invoice.invoice_number),
    footer: `${footer}${billing.kra_pin ? ` · KRA PIN ${billing.kra_pin}` : ""}`,
  });
}

/** One invoice's PDF by id, or null when there is no such invoice. */
export async function buildInvoicePdf(invoiceId: string): Promise<{ bytes: Uint8Array; number: string } | null> {
  const invoice = await getInvoiceForDocument(invoiceId);
  if (!invoice) return null;
  return { bytes: pdfFromContext(invoice, await invoiceContext(invoice)), number: invoice.invoice_number };
}

/** Subject, HTML and plain text for one email — pure, so it can be previewed and checked without sending. */
export function invoiceEmailContent(args: {
  suspendOn?: string | null;
  kind: InvoiceEmailKind;
  invoice: InvoiceForDocument;
  paid: number;
  paidOn: string;
  settings: BillingSettings;
  viewUrl: string;
  logoUrl: string;
  footer: string;
}) {
  const message = compose(args.kind, args.invoice, args.paid, args.paidOn, args.settings, args.suspendOn);
  return {
    subject: subjectFor(args.kind, args.invoice, args.suspendOn),
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
  opts: { throwOnSkip?: boolean; paidOn?: string; testTo?: string; suspendOn?: string | null } = {},
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

  const ctx = await invoiceContext(invoice, opts.paidOn);
  const { billing, paid, paidOn, footer } = ctx;
  const viewUrl = absoluteUrl(`/invoice/${invoice.id}`);
  const content = invoiceEmailContent({
    suspendOn: opts.suspendOn,
    kind,
    invoice,
    paid,
    paidOn: paidOn ?? new Date().toISOString().slice(0, 10),
    settings: billing,
    viewUrl,
    logoUrl: absoluteUrl("/EDOS-LOGOty-1.png"),
    footer,
  });

  const attachments: { filename: string; content: string }[] = [];
  if (billing.attach_pdf) {
    try {
      const pdf = pdfFromContext(invoice, ctx, kind === "payment_received");
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
