import type { InvoiceForDocument } from "@/lib/admin/queries";
import { formatDate } from "@/lib/utils";
import { vatLabel } from "@/lib/admin/vat";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  pending: "Pending",
  paid: "Paid",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

function money(n: number, currency: string) {
  return `${currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function InvoiceDocument({
  invoice,
  settings,
  kraPin,
}: {
  invoice: InvoiceForDocument;
  settings: Record<string, string>;
  /** Printed under the seller once VAT is charged — KRA expects it on a tax invoice. */
  kraPin?: string | null;
}) {
  const client = invoice.edoscentreadmin_clients;
  const isPaid = invoice.status === "paid";

  return (
    <div className="mx-auto max-w-3xl bg-white p-10 text-slate-800 print:p-0 print:max-w-none">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-slate-200 pb-8">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/EDOS-LOGOty-1.png" alt="Edos Centre" className="h-10 w-auto" />
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold tracking-wide text-slate-900">INVOICE</div>
          <div className="mt-1 font-mono text-sm text-slate-500">{invoice.invoice_number}</div>
        </div>
      </div>

      {/* From / Bill to */}
      <div className="mt-8 grid grid-cols-2 gap-8">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">From</div>
          <div className="mt-2 text-sm leading-relaxed text-slate-700">
            <div className="font-semibold text-slate-900">Edos Centre</div>
            {settings.contact_location && <div>{settings.contact_location}</div>}
            {settings.contact_email && <div>{settings.contact_email}</div>}
            {settings.contact_phone && <div>{settings.contact_phone}</div>}
            {kraPin && <div>KRA PIN {kraPin}</div>}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Bill to</div>
          <div className="mt-2 text-sm leading-relaxed text-slate-700">
            <div className="font-semibold text-slate-900">{client?.company_name ?? "—"}</div>
            {client?.contact_person && <div>{client.contact_person}</div>}
            {client?.address && <div>{client.address}</div>}
            {client?.email && <div>{client.email}</div>}
            {client?.phone && <div>{client.phone}</div>}
          </div>
        </div>
      </div>

      {/* Meta */}
      <div className="mt-8 grid grid-cols-4 gap-4 rounded-xl bg-slate-50 p-5 text-sm">
        <div>
          <div className="text-xs text-slate-400">Issue date</div>
          <div className="mt-0.5 font-medium text-slate-800">{formatDate(invoice.issue_date)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Due date</div>
          <div className="mt-0.5 font-medium text-slate-800">{formatDate(invoice.due_date)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Status</div>
          <div className={`mt-0.5 font-medium ${isPaid ? "text-emerald-600" : "text-slate-800"}`}>
            {STATUS_LABELS[invoice.status] ?? invoice.status}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-400">Amount due</div>
          <div className="mt-0.5 font-semibold text-slate-900">{money(invoice.total, invoice.currency)}</div>
        </div>
      </div>

      {/* Line items */}
      <table className="mt-8 w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wider text-slate-400">
            <th className="pb-2 font-medium">Description</th>
            <th className="pb-2 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          <tr>
            <td className="py-3">
              {invoice.notes || "Professional services"}
              {invoice.edoscentreadmin_websites?.name && (
                <div className="text-xs text-slate-400">{invoice.edoscentreadmin_websites.name}</div>
              )}
            </td>
            <td className="py-3 text-right">{money(invoice.amount, invoice.currency)}</td>
          </tr>
          {invoice.tax > 0 && (
            <tr>
              <td className="py-3 text-slate-500">{vatLabel(Number(invoice.amount), Number(invoice.tax))}</td>
              <td className="py-3 text-right text-slate-500">{money(invoice.tax, invoice.currency)}</td>
            </tr>
          )}
          {invoice.discount > 0 && (
            <tr>
              <td className="py-3 text-slate-500">Discount</td>
              <td className="py-3 text-right text-slate-500">-{money(invoice.discount, invoice.currency)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-800">
            <td className="pt-3 font-semibold text-slate-900">Total</td>
            <td className="pt-3 text-right text-lg font-bold text-slate-900">{money(invoice.total, invoice.currency)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Footer */}
      <div className="mt-12 border-t border-slate-100 pt-6 text-center text-xs text-slate-400">
        Thank you for working with Edos Centre.
        {settings.contact_email && <> Questions about this invoice? Reach us at {settings.contact_email}.</>}
      </div>
    </div>
  );
}
