import "server-only";
import { Resend } from "resend";
import { absoluteUrl } from "@/lib/seo";
import { getSiteSettings } from "@/lib/queries";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * EDOS Centre's own operational emails — new enquiries, support alerts — in
 * the format the billing emails use: the logo, a headline, one sentence, the
 * message quoted, a table of facts, one button, EDOS Centre's contacts.
 *
 * The inbox is EDOS Centre's contact email as set under Settings → Business
 * details (contact_email), so changing it there changes where these go.
 */

export const FALLBACK_INBOX = "info@edoscentre.co.ke";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface EdosEmail {
  headline: string;
  lead: string;
  /** Free text from a visitor or client, quoted as-is (escaped, line breaks kept). */
  quote?: string;
  rows: [string, string][];
  cta: string;
  url: string;
}

export async function edosContacts() {
  const site = await getSiteSettings();
  const email = site.contact_email || FALLBACK_INBOX;
  const phone = site.contact_phone || "+254 721 201 287";
  return { inbox: email, footer: `EDOS Centre · ${email} · ${phone}` };
}

export function edosEmailHtml(o: EdosEmail, footer: string): string {
  const rows = o.rows
    .map(
      ([k, v], i) =>
        `<tr><td style="padding:8px 16px 8px 0;font-size:14px;color:#5b625d;white-space:nowrap;vertical-align:top;${i ? "border-top:1px solid #e2e6e2;" : ""}">${esc(k)}</td><td style="padding:8px 0;font-size:14px;text-align:right;font-weight:700;${i ? "border-top:1px solid #e2e6e2;" : ""}">${esc(v)}</td></tr>`,
    )
    .join("");
  const quote = o.quote
    ? `<div style="margin:18px 0 0;padding:14px 16px;background:#f4f6f4;border-left:3px solid #0b7a44;border-radius:6px;font-size:14px;line-height:1.6;color:#171a19;white-space:pre-wrap;">${esc(o.quote)}</div>`
    : "";
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f6f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#171a19;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:540px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e2e6e2;">
      <tr><td style="padding:26px 28px 6px;">
        <img src="${esc(absoluteUrl("/EDOS-LOGOty-1.png"))}" alt="EDOS Centre" height="40" style="display:block;height:40px;width:auto;border:0;" />
        <h1 style="margin:18px 0 0;font-size:22px;line-height:1.3;color:#171a19;">${esc(o.headline)}</h1>
      </td></tr>
      <tr><td style="padding:10px 28px 4px;">
        <p style="margin:0;font-size:15px;line-height:1.6;">${esc(o.lead)}</p>
        ${quote}
        <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:18px 0 0;border-top:1px solid #e2e6e2;">${rows}</table>
        <p style="margin:22px 0 0;">
          <a href="${esc(o.url)}" style="display:inline-block;background:#0b7a44;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:8px;">${esc(o.cta)}</a>
        </p>
      </td></tr>
      <tr><td style="padding:18px 28px 26px;">
        <p style="margin:0;font-size:12px;line-height:1.6;color:#5b625d;border-top:1px solid #e2e6e2;padding-top:14px;">${esc(footer)}</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function edosEmailText(o: EdosEmail, footer: string): string {
  return [o.headline, "", o.lead, ...(o.quote ? ["", o.quote] : []), "", ...o.rows.map(([k, v]) => `${k}: ${v}`), "", `${o.cta}: ${o.url}`, "", footer].join("\n");
}

/** Sends, never throws: an alert that fails must not fail the form or request that caused it. */
export async function sendEdosEmail(input: {
  to: string[];
  subject: string;
  email: EdosEmail;
  replyTo?: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = [...new Set(input.to.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  if (!apiKey || !from) return { sent: false, reason: "Email isn't configured — set RESEND_API_KEY and RESEND_FROM_EMAIL." };
  if (!to.length) return { sent: false, reason: "No recipient." };
  const { footer } = await edosContacts();
  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: `Edos Centre <${from}>`,
      to,
      subject: input.subject,
      html: edosEmailHtml(input.email, footer),
      text: edosEmailText(input.email, footer),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
    if (error) {
      console.error("[edos-email] failed:", error.message);
      return { sent: false, reason: error.message };
    }
    return { sent: true };
  } catch (err) {
    console.error("[edos-email] failed:", err);
    return { sent: false, reason: err instanceof Error ? err.message : "Could not send." };
  }
}

/** Active super admins — who gets the bell notifications and the admin copies. */
export async function superAdmins(): Promise<{ id: string; email: string }[]> {
  const supabase = await createServiceClient();
  const { data } = await supabase.from("edoscentreadmin_admin_users").select("id, email").eq("role", "super_admin").eq("is_active", true);
  return data ?? [];
}
