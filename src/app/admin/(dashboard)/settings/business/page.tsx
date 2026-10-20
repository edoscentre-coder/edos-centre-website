import { getSiteSettings } from "@/lib/queries";
import { getBillingSettings } from "@/lib/admin/billing-settings";
import BusinessDetailsForm from "@/components/admin/settings/BusinessDetailsForm";

export const metadata = { title: "Business details — Settings — EDOS Control Centre" };
export const dynamic = "force-dynamic";

export default async function BusinessDetailsPage() {
  const [site, billing] = await Promise.all([getSiteSettings(), getBillingSettings()]);
  return (
    <BusinessDetailsForm
      initial={{
        contact_email: site.contact_email ?? "",
        contact_phone: site.contact_phone ?? "",
        contact_location: site.contact_location ?? "",
        kra_pin: billing.kra_pin ?? "",
      }}
      pinEditable={billing.migrated}
    />
  );
}
