"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wallet, Smartphone, RefreshCw, FileText, Mail } from "lucide-react";
import EntityManager from "@/components/admin/cms/EntityManager";
import { StatusBadge } from "@/components/admin/ui/Badge";
import { Input, Textarea, Label, Select } from "@/components/admin/ui/Input";
import { Button } from "@/components/admin/ui/Button";
import { Drawer } from "@/components/admin/ui/Drawer";
import { Card } from "@/components/admin/ui/Card";
import { upsertInvoice, deleteInvoice, recordPayment } from "@/lib/admin/actions/invoice-actions";
import { initiateMpesaPayment, checkMpesaTransactionStatus } from "@/lib/admin/actions/mpesa-actions";
import { sendInvoiceEmail } from "@/lib/admin/actions/invoice-email-actions";
import { formatDate } from "@/lib/utils";
import { vatSplit } from "@/lib/admin/vat";
import { InvoiceViewer } from "@/components/admin/billing/InvoiceViewer";
import type { Database } from "@/types/database.types";
import type { InvoiceWithRelations, PaymentWithRelations } from "@/lib/admin/queries";

type Client = Database["public"]["Tables"]["edoscentreadmin_clients"]["Row"];
type Website = Database["public"]["Tables"]["edoscentreadmin_websites"]["Row"];
type Subscription = Database["public"]["Tables"]["edoscentreadmin_subscriptions"]["Row"];
type MpesaTransaction = Database["public"]["Tables"]["edoscentreadmin_mpesa_transactions"]["Row"];

const INVOICE_STATUSES = ["draft", "sent", "pending", "paid", "partially_paid", "overdue", "cancelled"];
const PAYMENT_METHODS = ["mpesa", "bank", "card", "paypal", "cash", "other"];

export default function InvoicesManager({
  invoices,
  payments,
  clients,
  websites,
  subscriptions,
  mpesaTransactions,
  vat = { enabled: false, rate: 16 },
}: {
  invoices: InvoiceWithRelations[];
  payments: PaymentWithRelations[];
  clients: Client[];
  websites: Website[];
  subscriptions: Subscription[];
  mpesaTransactions: MpesaTransaction[];
  /** From Billing automation: whether "Add VAT" starts ticked on a new invoice, and at what rate. */
  vat?: { enabled: boolean; rate: number };
}) {
  const router = useRouter();
  const [paymentInvoice, setPaymentInvoice] = useState<InvoiceWithRelations | null>(null);
  const [mpesaInvoice, setMpesaInvoice] = useState<InvoiceWithRelations | null>(null);
  const [pending, setPending] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ id: string; number: string } | null>(null);

  async function onEmailInvoice(invoiceId: string) {
    setEmailingId(invoiceId);
    try {
      await sendInvoiceEmail(invoiceId);
      toast.success("Invoice emailed to the client.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to email invoice.");
    } finally {
      setEmailingId(null);
    }
  }

  async function onRecordPayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      await recordPayment(new FormData(e.currentTarget));
      toast.success("Payment recorded.");
      setPaymentInvoice(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to record payment.");
    } finally {
      setPending(false);
    }
  }

  async function onSendMpesaRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    try {
      const result = await initiateMpesaPayment(new FormData(e.currentTarget));
      toast.success(result.customerMessage || "STK push sent — ask the client to check their phone.");
      setMpesaInvoice(null);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to send M-Pesa request.");
    } finally {
      setPending(false);
    }
  }

  async function onCheckStatus(txnId: string) {
    setCheckingId(txnId);
    try {
      const result = await checkMpesaTransactionStatus(txnId);
      if (result.status === "pending") toast.info("Still pending — the client hasn't completed it yet.");
      else if (result.status === "completed") toast.success("Payment confirmed.");
      else toast.error(`Failed: ${"reason" in result ? result.reason : result.status}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to check status.");
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Invoices &amp; Payments</h1>
        <p className="mt-1 text-sm text-slate-500">Bill clients and record what&apos;s actually been paid.</p>
      </div>

      <EntityManager<InvoiceWithRelations>
        title="Invoices"
        description="Every invoice is generated with a sequential number automatically."
        newLabel="New invoice"
        items={invoices}
        getId={(i) => i.id}
        getLabel={(i) => i.invoice_number}
        drawerTitle={(editing) => (editing ? `Edit ${editing.invoice_number}` : "New invoice")}
        columns={[
          { header: "Invoice #", render: (i) => <span className="font-mono text-xs font-medium text-slate-900">{i.invoice_number}</span> },
          { header: "Client", render: (i) => i.edoscentreadmin_clients?.company_name ?? "—" },
          { header: "Total", render: (i) => `${i.currency} ${Number(i.total).toLocaleString()}` },
          { header: "Due", render: (i) => formatDate(i.due_date) },
          { header: "Status", render: (i) => <StatusBadge status={i.status} /> },
          {
            header: "",
            render: (i) => (
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewing({ id: i.id, number: i.invoice_number });
                  }}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <FileText className="h-3.5 w-3.5" /> View / PDF
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onEmailInvoice(i.id);
                  }}
                  disabled={emailingId === i.id}
                  className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Mail className="h-3.5 w-3.5" /> {emailingId === i.id ? "Sending…" : "Email"}
                </button>
                {i.status !== "paid" && i.status !== "cancelled" && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMpesaInvoice(i);
                      }}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <Smartphone className="h-3.5 w-3.5" /> M-Pesa
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPaymentInvoice(i);
                      }}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                    >
                      <Wallet className="h-3.5 w-3.5" /> Record payment
                    </button>
                  </>
                )}
              </div>
            ),
          },
        ]}
        renderFields={(editing) => (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="client_id">Client</Label>
                <Select id="client_id" name="client_id" required defaultValue={editing?.client_id ?? ""}>
                  <option value="" disabled>
                    Select client
                  </option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="website_id">Website</Label>
                <Select id="website_id" name="website_id" defaultValue={editing?.website_id ?? ""}>
                  <option value="">—</option>
                  {websites.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="subscription_id">Subscription (optional — links payment to renew it)</Label>
              <Select id="subscription_id" name="subscription_id" defaultValue={editing?.subscription_id ?? ""}>
                <option value="">—</option>
                {subscriptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id.slice(0, 8)} — {s.billing_cycle} {s.currency} {s.amount}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="issue_date">Issue date</Label>
                <Input id="issue_date" name="issue_date" type="date" required defaultValue={editing?.issue_date ?? new Date().toISOString().slice(0, 10)} />
              </div>
              <div>
                <Label htmlFor="due_date">Due date</Label>
                <Input id="due_date" name="due_date" type="date" required defaultValue={editing?.due_date ?? ""} />
              </div>
            </div>
            <AmountFields key={editing?.id ?? "new"} editing={editing} vat={vat} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" name="currency" defaultValue={editing?.currency ?? "KES"} />
              </div>
              <div>
                <Label htmlFor="status">Status</Label>
                <Select id="status" name="status" defaultValue={editing?.status ?? "draft"}>
                  {INVOICE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={editing?.notes ?? ""} />
            </div>
          </>
        )}
        onSubmit={async (formData, editing) => upsertInvoice(formData, editing?.id)}
        onDelete={async (i) => deleteInvoice(i.id, i.invoice_number)}
      />

      <div>
        <h2 className="text-lg font-medium text-slate-900">Payment history</h2>
        <p className="mt-1 text-sm text-slate-500">Every payment recorded against an invoice.</p>
        <Card className="mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Invoice</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Method</th>
                  <th className="px-5 py-3">Reference</th>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                      No payments recorded yet.
                    </td>
                  </tr>
                ) : (
                  payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs">{p.edoscentreadmin_invoices?.invoice_number ?? "—"}</td>
                      <td className="px-5 py-3">
                        {p.currency} {Number(p.amount).toLocaleString()}
                      </td>
                      <td className="px-5 py-3 uppercase text-slate-500">{p.payment_method}</td>
                      <td className="px-5 py-3 text-slate-500">{p.transaction_reference ?? "—"}</td>
                      <td className="px-5 py-3 text-xs text-slate-400">{formatDate(p.payment_date)}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-medium text-slate-900">M-Pesa requests</h2>
        <p className="mt-1 text-sm text-slate-500">Every STK push sent, and whether the client completed it.</p>
        <Card className="mt-4 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3">Phone</th>
                  <th className="px-5 py-3">Amount</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Sent</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mpesaTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-slate-400">
                      No M-Pesa requests sent yet.
                    </td>
                  </tr>
                ) : (
                  mpesaTransactions.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-mono text-xs">{t.phone_number}</td>
                      <td className="px-5 py-3">KES {Number(t.amount).toLocaleString()}</td>
                      <td className="px-5 py-3">
                        <StatusBadge status={t.status} />
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-400">{formatDate(t.created_at)}</td>
                      <td className="px-5 py-3 text-right">
                        {t.status === "pending" && (
                          <button
                            onClick={() => onCheckStatus(t.id)}
                            disabled={checkingId === t.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <RefreshCw className={`h-3.5 w-3.5 ${checkingId === t.id ? "animate-spin" : ""}`} /> Check status
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Drawer
        open={!!mpesaInvoice}
        onOpenChange={(open) => !open && setMpesaInvoice(null)}
        title={`Send M-Pesa request — ${mpesaInvoice?.invoice_number ?? ""}`}
        description={mpesaInvoice ? `Balance due: ${mpesaInvoice.currency} ${Number(mpesaInvoice.total).toLocaleString()}` : undefined}
      >
        {mpesaInvoice && (
          <form onSubmit={onSendMpesaRequest} className="space-y-4">
            <input type="hidden" name="invoice_id" value={mpesaInvoice.id} />
            <div>
              <Label htmlFor="phone">Client phone number</Label>
              <Input id="phone" name="phone" required placeholder="07XXXXXXXX" />
              <p className="mt-1 text-xs text-slate-400">The client will get a PIN prompt on this number for the full outstanding balance.</p>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setMpesaInvoice(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                Send request
              </Button>
            </div>
          </form>
        )}
      </Drawer>

      <Drawer
        open={!!paymentInvoice}
        onOpenChange={(open) => !open && setPaymentInvoice(null)}
        title={`Record payment — ${paymentInvoice?.invoice_number ?? ""}`}
        description={paymentInvoice ? `Balance due: ${paymentInvoice.currency} ${Number(paymentInvoice.total).toLocaleString()}` : undefined}
      >
        {paymentInvoice && (
          <form onSubmit={onRecordPayment} className="space-y-4">
            <input type="hidden" name="invoice_id" value={paymentInvoice.id} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="amount">Amount received</Label>
                <Input id="amount" name="amount" type="number" step="0.01" required defaultValue={paymentInvoice.total} />
              </div>
              <div>
                <Label htmlFor="payment_method">Method</Label>
                <Select id="payment_method" name="payment_method" defaultValue="bank">
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="transaction_reference">Transaction reference</Label>
              <Input id="transaction_reference" name="transaction_reference" placeholder="M-Pesa code, bank ref, etc." />
            </div>
            <div>
              <Label htmlFor="payment_date">Payment date</Label>
              <Input id="payment_date" name="payment_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="secondary" onClick={() => setPaymentInvoice(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending}>
                Record payment
              </Button>
            </div>
          </form>
        )}
      </Drawer>
      <InvoiceViewer invoiceId={viewing?.id ?? null} invoiceNumber={viewing?.number} onClose={() => setViewing(null)} />
    </div>
  );
}

/**
 * Amount, VAT and discount. "Add VAT" fills the tax in from the amount at the
 * rate set under Billing automation and shows the total as it will be saved;
 * unticked, the tax field is typed by hand as before. The server works the
 * VAT out again itself when the box is ticked.
 */
function AmountFields({ editing, vat }: { editing: InvoiceWithRelations | null; vat: { enabled: boolean; rate: number } }) {
  const [amount, setAmount] = useState(editing ? String(editing.amount) : "");
  const [discount, setDiscount] = useState(editing ? String(editing.discount) : "0");
  const editingVat = editing ? Number(editing.tax) > 0 && Math.abs(vatSplit(Number(editing.amount), vat.rate, false).tax - Number(editing.tax)) < 0.01 : vat.enabled;
  const [applyVat, setApplyVat] = useState(editingVat);
  const [typedTax, setTypedTax] = useState(editing ? String(editing.tax) : "0");

  const n = (v: string) => Number(v) || 0;
  const tax = applyVat ? vatSplit(n(amount), vat.rate, false).tax : n(typedTax);
  const total = n(amount) + tax - n(discount);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <Label htmlFor="amount">Amount{applyVat ? " (before VAT)" : ""}</Label>
          <Input id="amount" name="amount" type="number" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="tax">{applyVat ? `VAT (${vat.rate}%)` : "Tax"}</Label>
          <Input
            id="tax"
            name="tax"
            type="number"
            step="0.01"
            value={applyVat ? String(tax) : typedTax}
            readOnly={applyVat}
            onChange={(e) => setTypedTax(e.target.value)}
            className={applyVat ? "bg-slate-50 text-slate-500" : undefined}
          />
        </div>
        <div>
          <Label htmlFor="discount">Discount</Label>
          <Input id="discount" name="discount" type="number" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <label className="flex items-center gap-2 text-slate-700">
          <input
            type="checkbox"
            name="apply_vat"
            checked={applyVat}
            onChange={(e) => setApplyVat(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[#1A1733] focus:ring-[#1A1733]/30"
          />
          Add VAT at {vat.rate}%
        </label>
        <span className="text-slate-500">
          Total <span className="font-semibold text-slate-900">{total.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </span>
      </div>
    </div>
  );
}
