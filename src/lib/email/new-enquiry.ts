import "server-only";
import { absoluteUrl } from "@/lib/seo";
import { createServiceClient } from "@/lib/supabase/server";
import { edosContacts, sendEdosEmail, superAdmins } from "@/lib/email/edos-email";

/**
 * A new contact-form message or consultation booking from the website,
 * emailed to EDOS Centre's inbox (Settings → Business details, normally
 * info@edoscentre.co.ke) with Reply going straight to the visitor, and a bell
 * notification for each super admin. The submission is already saved before
 * this runs; this only makes sure someone hears about it. Never throws.
 */

const FORMS_URL = "/admin/websites/edos-centre/forms";

export async function notifyNewEnquiry(e: {
  kind: "contact" | "consultation";
  id: string | null;
  name: string;
  email: string;
  phone?: string | null;
  organization?: string | null;
  subject?: string | null;
  message?: string | null;
  inquiryType?: string | null;
  roleTitle?: string | null;
  budget?: string | null;
  preferredDate?: string | null;
  preferredTime?: string | null;
  sourcePage?: string | null;
}) {
  try {
    const [{ inbox }, admins] = await Promise.all([edosContacts(), superAdmins()]);
    const isBooking = e.kind === "consultation";
    const headline = isBooking ? "New consultation booking" : "New message from the website";
    const about = isBooking ? "booked a consultation" : e.subject ? `wrote about “${e.subject}”` : "sent a message";

    const rows: [string, string][] = [
      ["Name", e.name],
      ["Email", e.email],
      ...(e.phone ? [["Phone", e.phone] as [string, string]] : []),
      ...(e.organization ? [["Organisation", e.organization] as [string, string]] : []),
      ...(e.roleTitle ? [["Role", e.roleTitle] as [string, string]] : []),
      ...(e.inquiryType && e.inquiryType !== "general" ? [["Type", e.inquiryType.replace(/_/g, " ")] as [string, string]] : []),
      ...(e.budget ? [["Budget", e.budget] as [string, string]] : []),
      ...(e.preferredDate ? [["Preferred date", [e.preferredDate, e.preferredTime].filter(Boolean).join(" ")] as [string, string]] : []),
      ...(e.sourcePage ? [["Sent from", e.sourcePage] as [string, string]] : []),
    ];

    await sendEdosEmail({
      to: [inbox],
      subject: `${headline}: ${e.name}${e.subject ? ` — ${e.subject}` : ""}`,
      // Hitting Reply answers the visitor, not the website.
      replyTo: e.email,
      email: {
        headline,
        lead: `${e.name}${e.organization ? ` (${e.organization})` : ""} ${about} on edoscentre.co.ke. Reply to this email to answer them directly.`,
        quote: e.message ?? undefined,
        rows,
        cta: "Open in the admin",
        url: absoluteUrl(FORMS_URL),
      },
    });

    if (admins.length) {
      const supabase = await createServiceClient();
      await supabase.from("edoscentreadmin_notifications").upsert(
        admins.map((a) => ({
          recipient_id: a.id,
          type: isBooking ? "consultation_new" : "contact_new",
          severity: "info" as const,
          title: `${headline} — ${e.name}`,
          message: e.subject || e.message?.slice(0, 140) || e.email,
          link: FORMS_URL,
          dedup_key: `${e.kind}:${e.id ?? `${e.email}:${Date.now()}`}`,
        })),
        { onConflict: "recipient_id,dedup_key", ignoreDuplicates: true },
      );
    }
  } catch (err) {
    console.error("[new-enquiry] notify failed:", err);
  }
}
