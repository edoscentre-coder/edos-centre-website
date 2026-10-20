"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePortalUser } from "@/lib/portal/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { addMessage, createTicket, getTicket, tellAdmins, CATEGORIES, type Category } from "@/lib/support/support";

/**
 * Client side of the support desk. The portal user is checked here, and every
 * ticket they touch must belong to their own client — the server writes with
 * the service role, so this check is the boundary.
 */

export type PortalSupportResult = { ok: true; id?: string } | { ok: false; error: string };

async function attempt(fn: () => Promise<string | void>): Promise<PortalSupportResult> {
  try {
    const id = await fn();
    return { ok: true, ...(id ? { id } : {}) };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Check the form." };
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false, error: message === "UNAUTHORIZED" ? "Your session has ended — sign in again." : message };
  }
}

const openSchema = z.object({
  subject: z.string().trim().min(3, "Give the request a short subject.").max(200, "Keep the subject under 200 characters."),
  category: z.enum(Object.keys(CATEGORIES) as [Category, ...Category[]]),
  website_id: z.string().optional(),
  urgent: z.literal("on").optional(),
  body: z.string().trim().min(5, "Describe what you need.").max(5000, "Keep it under 5,000 characters."),
});

export async function openSupportRequest(formData: FormData) {
  return attempt(async () => {
    const user = await requirePortalUser();
    if (!(await checkRateLimit("support-open", user.id, 10, 3600))) {
      throw new Error("You've opened several requests in the last hour — please wait a little, or reply on an existing one.");
    }
    const f = openSchema.parse(Object.fromEntries(formData));

    // Only one of this client's own websites can be named.
    let websiteId: string | null = null;
    if (f.website_id) {
      const supabase = await createServiceClient();
      const { data } = await supabase
        .from("edoscentreadmin_subscriptions")
        .select("website_id")
        .eq("client_id", user.client_id)
        .eq("website_id", f.website_id)
        .limit(1);
      if (!data?.length) throw new Error("That website isn't one of yours.");
      websiteId = f.website_id;
    }

    const created = await createTicket({
      clientId: user.client_id,
      websiteId,
      subject: f.subject,
      category: f.category,
      priority: f.urgent === "on" ? "high" : "normal",
      body: f.body,
      portalUserId: user.id,
      adminId: null,
      authorName: user.full_name || user.email,
    });

    const found = await getTicket(created.id, { clientId: user.client_id, withInternal: false });
    if (found) await tellAdmins(found.ticket, "new", f.body, created.id);
    revalidatePath("/portal/support");
    return created.id;
  });
}

const replySchema = z.object({
  body: z.string().trim().min(1, "Write a reply first.").max(5000, "Keep it under 5,000 characters."),
});

/** A client's reply. Replying on a resolved request opens it again. */
export async function replyAsClient(ticketId: string, formData: FormData) {
  return attempt(async () => {
    const user = await requirePortalUser();
    if (!(await checkRateLimit("support-reply", user.id, 30, 3600))) throw new Error("Too many replies in a short time — please wait a little.");
    const f = replySchema.parse(Object.fromEntries(formData));
    const found = await getTicket(ticketId, { clientId: user.client_id, withInternal: false });
    if (!found) throw new Error("That request was not found.");

    const messageId = await addMessage({
      ticketId,
      authorType: "client",
      portalUserId: user.id,
      authorName: user.full_name || user.email,
      body: f.body,
      status: "open",
    });
    await tellAdmins(found.ticket, "client_reply", f.body, messageId);
    revalidatePath(`/portal/support/${ticketId}`);
    revalidatePath("/portal/support");
  });
}
