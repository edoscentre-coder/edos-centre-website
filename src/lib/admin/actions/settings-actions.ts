"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin/auth";
import { logAudit } from "@/lib/admin/audit";
import { createServiceClient } from "@/lib/supabase/server";
import { getBillingSettings } from "@/lib/admin/billing-settings";

/**
 * Settings → My account and Business details. Errors come back as values, not
 * throws, so a production build shows the real message.
 */

export type SettingsResult = { ok: true } | { ok: false; error: string };

async function attempt(fn: () => Promise<void>): Promise<SettingsResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof z.ZodError) return { ok: false, error: err.issues[0]?.message ?? "Check the form." };
    const message = err instanceof Error ? err.message : "Something went wrong.";
    return { ok: false, error: message === "UNAUTHORIZED" ? "Your session has ended — sign in again." : message };
  }
}

export async function updateMyName(formData: FormData) {
  return attempt(async () => {
    const admin = await requireAdmin();
    const fullName = z.string().trim().max(120, "Keep the name under 120 characters.").parse(formData.get("full_name") ?? "");
    const supabase = await createServiceClient();
    const { error } = await supabase
      .from("edoscentreadmin_admin_users")
      .update({ full_name: fullName || null })
      .eq("id", admin.id);
    if (error) throw new Error(error.message);
    await logAudit({ actorId: admin.id, action: "admin_profile_updated", metadata: { full_name: fullName } });
    revalidatePath("/admin/settings");
    revalidatePath("/admin", "layout");
  });
}

const businessSchema = z.object({
  contact_email: z.email("Enter a valid email address."),
  contact_phone: z.string().trim().min(5, "Enter a phone number.").max(40),
  contact_location: z.string().trim().min(2, "Enter the location.").max(160),
  kra_pin: z
    .string()
    .trim()
    .max(20)
    .transform((v) => v.toUpperCase()),
});

/**
 * The details printed on invoices, emails and the website footer. Contact
 * details stay in Site settings and the KRA PIN in billing settings — the
 * places everything already reads them from — so nothing goes out of step.
 */
export async function saveBusinessDetails(formData: FormData) {
  return attempt(async () => {
    const admin = await requireAdmin("edos-centre");
    const f = businessSchema.parse(Object.fromEntries(formData));
    const supabase = await createServiceClient();

    // Updated in place, so each setting keeps its description; added only if missing.
    for (const [key, value] of [
      ["contact_email", f.contact_email],
      ["contact_phone", f.contact_phone],
      ["contact_location", f.contact_location],
    ] as const) {
      const { data: updated, error } = await supabase.from("edoscentre_site_settings").update({ value }).eq("key", key).select("id");
      if (error) throw new Error(error.message);
      if (!updated?.length) {
        const { error: insertError } = await supabase.from("edoscentre_site_settings").insert({ key, value, description: null });
        if (insertError) throw new Error(insertError.message);
      }
    }

    const billing = await getBillingSettings();
    if (billing.migrated) {
      const { error: pinError } = await supabase.from("edoscentreadmin_billing_settings").update({ kra_pin: f.kra_pin || null }).eq("id", 1);
      if (pinError) throw new Error(pinError.message);
    }

    await logAudit({ actorId: admin.id, action: "business_details_updated", metadata: { ...f } });
    revalidatePath("/admin/settings/business");
    revalidatePath("/", "layout");
  });
}
