import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getInvoiceForDocument } from "@/lib/admin/queries";
import { getSiteSettings } from "@/lib/queries";
import { getBillingSettings } from "@/lib/admin/billing-settings";
import InvoiceDocument from "@/components/admin/billing/InvoiceDocument";
import PrintButton from "@/components/PrintButton";

export const metadata = { title: "Invoice — EDOS Control Centre" };

export default async function AdminInvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [invoice, settings, billing] = await Promise.all([getInvoiceForDocument(id), getSiteSettings(), getBillingSettings()]);
  if (!invoice) notFound();

  return (
    <div>
      <div className="no-print mb-6 flex items-center justify-between">
        <Link href="/admin/invoices" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Back to invoices
        </Link>
        <PrintButton />
      </div>
      <div className="rounded-2xl border border-slate-200 shadow-sm print:border-0 print:shadow-none">
        <InvoiceDocument invoice={invoice} settings={settings} kraPin={billing.kra_pin} />
      </div>
    </div>
  );
}
