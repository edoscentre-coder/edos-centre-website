"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { logAudit } from "@/lib/admin/audit";
import { addMessage, getTicket, tellClient, updateTicket, PRIORITIES, STATUSES, type Priority, type Status } from "@/lib/support/support";

/** Admin side of the support desk. Errors come back as values so production shows them. */

export type SupportResult = { ok: true } | { ok: false; error: string };

async function attempt(fn: () => Promise<void>): Promise<SupportResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Check the form." };
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false, error: message === "UNAUTHORIZED" ? "Your session has ended — sign in again." : message };
  }
}

const statusSchema = z.enum(Object.keys(STATUSES) as [Status, ...Status[]]);
const prioritySchema = z.enum(Object.keys(PRIORITIES) as [Priority, ...Priority[]]);

const replySchema = z.object({
  body: z.string().trim().min(1, "Write a reply first.").max(5000, "Keep it under 5,000 characters."),
  internal: z.literal("on").optional(),
  status: statusSchema.optional(),
});

/** A reply to the client, or an internal note (never shown to them, emails no one). */
export async function replyToTicket(ticketId: string, formData: FormData) {
  return attempt(async () => {
    const admin = await requireAdmin("edos-centre");
    const f = replySchema.parse(Object.fromEntries(formData));
    const found = await getTicket(ticketId, { withInternal: false });
    if (!found) throw new Error("That request was not found.");
    const internal = f.internal === "on";
    // A reply hands the ticket to the client unless the admin chose otherwise.
    const status: Status | undefined = internal ? undefined : (f.status ?? "waiting_on_client");

    await addMessage({
      ticketId,
      authorType: "admin",
      adminId: admin.id,
      authorName: admin.full_name || "EDOS Centre",
      body: f.body,
      isInternal: internal,
      status,
    });
    await logAudit({
      actorId: admin.id,
      action: internal ? "support_note_added" : "support_replied",
      metadata: { ticket: found.ticket.ticket_number, status },
    });

    if (!internal) await tellClient({ ...found.ticket, status: status ?? found.ticket.status }, status === "resolved" ? "resolved" : "reply", f.body);
    revalidatePath(`/admin/support/${ticketId}`);
    revalidatePath("/admin/support");
  });
}

/** Status and priority from the ticket's sidebar. Resolving tells the client. */
export async function updateTicketMeta(ticketId: string, patch: { status?: string; priority?: string }) {
  return attempt(async () => {
    const admin = await requireAdmin("edos-centre");
    const found = await getTicket(ticketId, { withInternal: false });
    if (!found) throw new Error("That request was not found.");
    const status = patch.status ? statusSchema.parse(patch.status) : undefined;
    const priority = patch.priority ? prioritySchema.parse(patch.priority) : undefined;
    await updateTicket(ticketId, { status, priority });
    await logAudit({ actorId: admin.id, action: "support_updated", metadata: { ticket: found.ticket.ticket_number, status, priority } });
    if (status === "resolved" && found.ticket.status !== "resolved") await tellClient({ ...found.ticket, status }, "resolved", null);
    revalidatePath(`/admin/support/${ticketId}`);
    revalidatePath("/admin/support");
  });
}
