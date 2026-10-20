import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { notifyNewEnquiry } from "@/lib/email/new-enquiry";

export async function POST(req: NextRequest) {
  try {
    const allowed = await checkRateLimit("contact", getClientIp(req), 5, 3600);
    if (!allowed) {
      return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
    }

    const body = await req.json();

    const { full_name, email, phone, organization, subject, message, inquiry_type, source_page } = body;

    if (!full_name || !email || !message) {
      return NextResponse.json({ error: "Name, email, and message are required." }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
    }

    const supabase = await createServiceClient();

    const { data: saved, error } = await supabase
      .schema("public")
      .from("edoscentre_contact_inquiries")
      .insert({
        full_name:    full_name.trim(),
        email:        email.toLowerCase().trim(),
        phone:        phone   || null,
        organization: organization || null,
        subject:      subject || null,
        message:      message.trim(),
        inquiry_type: inquiry_type || "general",
        source_page:  source_page  || req.headers.get("referer") || null,
        ip_address:   req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
        utm_source:   body.utm_source   || null,
        utm_medium:   body.utm_medium   || null,
        utm_campaign: body.utm_campaign || null,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[contact-route] db error:", error.message);
      return NextResponse.json({ error: "Failed to submit. Please try again." }, { status: 500 });
    }

    // Saved first; the email to EDOS Centre's inbox goes out after the
    // visitor has their answer, so a slow mail server never delays the form.
    after(() =>
      notifyNewEnquiry({
        kind: "contact",
        id: saved?.id ?? null,
        name: String(full_name).trim(),
        email: String(email).toLowerCase().trim(),
        phone: phone || null,
        organization: organization || null,
        subject: subject || null,
        message: String(message).trim(),
        inquiryType: inquiry_type || null,
        sourcePage: source_page || req.headers.get("referer") || null,
      }),
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[contact-route] error:", err);
    return NextResponse.json({ error: "Server error. Please try again." }, { status: 500 });
  }
}
