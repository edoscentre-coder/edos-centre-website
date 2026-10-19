import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getInvoiceForDocument } from "@/lib/admin/queries";
import { getSiteSettings } from "@/lib/queries";
import { getBillingSettings } from "@/lib/admin/billing-settings";
import InvoiceDocument from "@/components/admin/billing/InvoiceDocument";
import PrintButton from "@/components/PrintButton";

export const metadata: Metadata = {
  title: "Invoice — Edos Centre",
  robots: { index: false, follow: false },
};

/** Unauthenticated by design — this link is shared directly with a client via
 * email, the same pattern hosted invoice pages (Stripe, Supabase billing) use.
 * The invoice UUID is unguessable and never linked from anywhere crawlable;
 * robots noindex/robots.ts both also exclude it. */
export default async function PublicInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, settings, billing] = await Promise.all([getInvoiceForDocument(id), getSiteSettings(), getBillingSettings()]);
  if (!invoice) notFound();

  return (
    <div className="min-h-screen bg-slate-100 py-10 px-4">
      <div className="no-print mx-auto mb-6 flex max-w-3xl justify-end">
        <PrintButton />
      </div>
      <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none">
        <InvoiceDocument invoice={invoice} settings={settings} kraPin={billing.kra_pin} />
      </div>
    </div>
  );
}
