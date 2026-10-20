"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Mail, Play, Send, XCircle } from "lucide-react";
import { Button } from "@/components/admin/ui/Button";
import { Card, CardBody, CardHeader } from "@/components/admin/ui/Card";
import { Input, Label, Select, Textarea } from "@/components/admin/ui/Input";
import { Checkbox } from "@/components/admin/ui/Checkbox";
import { StatusBadge } from "@/components/admin/ui/Badge";
import {
  createRenewalInvoiceNow,
  runBillingSweepNow,
  saveBillingSettings,
  sendDraftInvoice,
  sendTestBillingEmail,
  setSubscriptionAutoInvoice,
  setSubscriptionAutoSuspend,
  type ActionResult,
} from "@/lib/admin/actions/billing-automation-actions";
import type { BillingSettings } from "@/lib/admin/billing-settings";
import type { RenewalCandidate } from "@/lib/admin/renewal-invoices";
import type { SuspensionCandidate } from "@/lib/admin/auto-suspend";
import type { InvoiceEmailKind } from "@/lib/admin/invoice-email";
import { InvoiceViewer } from "@/components/admin/billing/InvoiceViewer";
import type { InvoiceLite, LogRow, RecentInvoice, SubscriptionLite } from "@/app/admin/(dashboard)/billing-automation/page";

const money = (currency: string, n: number) =>
  `${currency} ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const date = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");

const KIND_LABEL: Record<string, string> = {
  view: "Invoice (manual)",
  new_invoice: "New invoice",
  reminder_due_soon: "Due-soon reminder",
  reminder_overdue: "Overdue notice",
  payment_received: "Payment receipt",
};

function errorText(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong.";
}

function Pill({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
        ok ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-amber-50 text-amber-800 ring-amber-600/20"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

export default function BillingAutomationManager({
  settings,
  cronConfigured,
  emailConfigured,
  renewals,
  suspensions,
  dueSoon,
  overdue,
  drafts,
  subscriptions,
  log,
  recentInvoices,
}: {
  settings: BillingSettings & { migrated: boolean; vatReady: boolean; suspendReady: boolean };
  cronConfigured: boolean;
  emailConfigured: boolean;
  renewals: RenewalCandidate[];
  suspensions: SuspensionCandidate[];
  dueSoon: InvoiceLite[];
  overdue: InvoiceLite[];
  drafts: InvoiceLite[];
  subscriptions: SubscriptionLite[];
  log: LogRow[];
  recentInvoices: RenewalInvoiceOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [testInvoice, setTestInvoice] = useState(recentInvoices[0]?.id ?? "");
  const [testKind, setTestKind] = useState<InvoiceEmailKind>("new_invoice");
  const [viewing, setViewing] = useState<{ id: string; number: string } | null>(null);

  const run = <T,>(key: string, fn: () => Promise<ActionResult<T>>, ok: (r: T) => string) => {
    setBusy(key);
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          toast.success(ok(r.data));
          router.refresh();
        } else {
          toast.error(r.error);
        }
      } catch (err) {
        toast.error(errorText(err));
      } finally {
        setBusy(null);
      }
    });
  };

  const willInvoice = renewals.filter((r) => !r.skip);
  const on = settings.automation_enabled;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Billing automation</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Renewal invoices for subscriptions, and the emails clients receive about their invoices. The daily check runs
            at 06:00 UTC (09:00 Nairobi). Manual invoices, payments and M-Pesa work as before.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill ok={settings.migrated}>{settings.migrated ? "Database ready" : "Migration 026 not run"}</Pill>
            <Pill ok={on}>{on ? "Automatic renewal invoices on" : "Automatic renewal invoices off"}</Pill>
            <Pill ok={emailConfigured}>{emailConfigured ? "Email configured" : "Email not configured (RESEND)"}</Pill>
            {settings.suspendReady && (
              <Pill ok={on && settings.auto_suspend}>
                {on && settings.auto_suspend ? "Automatic suspension on" : "Automatic suspension off"}
              </Pill>
            )}
            <Pill ok={cronConfigured}>{cronConfigured ? "Daily schedule configured" : "CRON_SECRET not set — daily check will not run"}</Pill>
          </div>
        </div>
        <Button
          variant="secondary"
          loading={busy === "run"}
          disabled={pending}
          onClick={() =>
            run("run", runBillingSweepNow, (x) =>
              `Done — ${x.renewalInvoicesCreated} renewal invoice(s), ${x.remindersSent} email(s), ${x.invoicesUpdated} invoice(s) marked overdue.`,
            )
          }
        >
          <Play className="h-4 w-4" /> Run today&apos;s check now
        </Button>
      </div>

      {!settings.migrated && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Run <code className="font-mono">supabase/migrations/026_billing_automation.sql</code> in Supabase to save settings and
          create renewal invoices. Until then the existing reminders keep working as before, and emails already use the new
          format with EDOS Centre&apos;s payment details.
        </div>
      )}

      {/* ── Today ─────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-900">What today&apos;s check would do</h2>
          <p className="text-sm text-slate-500">A preview — nothing here has been sent.</p>
        </CardHeader>
        <CardBody className="space-y-6">
          <section>
            <h3 className="text-sm font-semibold text-slate-700">
              Renewal invoices{" "}
              <span className="font-normal text-slate-500">
                — renewals in the next {settings.renewal_days_before} days
                {on ? (settings.auto_send_invoices ? ", created and emailed" : ", created as drafts for you to send") : ", not created while automation is off"}
              </span>
            </h3>
            {renewals.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No subscriptions renew in this window.</p>
            ) : (
              <table className="mt-2 w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {renewals.map((r) => (
                    <tr key={r.subscriptionId}>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-slate-900">{r.website}</div>
                        <div className="text-xs text-slate-500">
                          {r.client} · {r.clientEmail ?? <span className="text-amber-700">no email on file</span>}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">Renews {date(r.renewalDate)}</td>
                      <td className="py-2 pr-3 text-right font-medium">
                        {money(r.currency, r.total)}
                        {r.tax > 0 && <div className="text-xs font-normal text-slate-500">incl. VAT {money(r.currency, r.tax)}</div>}
                      </td>
                      <td className="py-2 text-right text-xs">
                        {r.skip ? <span className="text-slate-500">{r.skip}</span> : <span className="font-medium text-emerald-700">Will invoice</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-700">
              Due-soon reminders <span className="font-normal text-slate-500">— sent invoices due in the next 3 days</span>
            </h3>
            <InvoiceList rows={dueSoon} empty="None due." />
          </section>

          <section>
            <h3 className="text-sm font-semibold text-slate-700">
              Overdue <span className="font-normal text-slate-500">— marked overdue and the client notified once</span>
            </h3>
            <InvoiceList rows={overdue} empty="Nothing overdue." />
          </section>

          {settings.suspendReady && (
            <section>
              <h3 className="text-sm font-semibold text-slate-700">
                Suspensions{" "}
                <span className="font-normal text-slate-500">
                  — unpaid subscription invoices: final notice {settings.suspension_notice_days} day
                  {settings.suspension_notice_days === 1 ? "" : "s"} before, then suspended after the grace period
                  {on && settings.auto_suspend ? "" : " (automatic suspension is off — nothing will happen)"}
                </span>
              </h3>
              {suspensions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No unpaid subscription invoices past their due date.</p>
              ) : (
                <table className="mt-2 w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {suspensions.map((x) => (
                      <tr key={x.invoiceId}>
                        <td className="py-2 pr-3">
                          <div className="font-medium text-slate-900">{x.website}</div>
                          <div className="text-xs text-slate-500">
                            <span className="font-mono">{x.invoiceNumber}</span> · {x.client} · due {date(x.dueDate)}
                          </div>
                        </td>
                        <td className="py-2 pr-3 text-slate-600">Suspends {date(x.suspendDate)}</td>
                        <td className="py-2 pr-3 text-right font-medium">{money(x.currency, x.balance)}</td>
                        <td className="py-2 text-right text-xs">
                          <span
                            className={
                              x.stage === "suspend_due"
                                ? "font-medium text-red-700"
                                : x.stage === "blocked" || x.stage === "notice_due"
                                  ? "font-medium text-amber-700"
                                  : "text-slate-500"
                            }
                          >
                            {x.note}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {willInvoice.length > 0 && !on && (
            <p className="text-xs text-slate-500">
              Turn on automatic renewal invoices below to have these created, or use “Invoice now” per subscription.
            </p>
          )}
        </CardBody>
      </Card>

      {/* ── Drafts ────────────────────────────────────────────────────────── */}
      {drafts.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-slate-900">Renewal invoices waiting to be sent ({drafts.length})</h2>
            <p className="text-sm text-slate-500">Check each one, then send — the client receives the email with the PDF attached.</p>
          </CardHeader>
          <CardBody>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {drafts.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2 pr-3">
                      <div className="font-mono text-xs text-slate-500">{d.invoice_number}</div>
                      <div className="text-slate-900">{d.notes}</div>
                      <div className="text-xs text-slate-500">
                        {d.edoscentreadmin_clients?.company_name} · {d.edoscentreadmin_clients?.email ?? "no email on file"}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">Due {date(d.due_date)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{money(d.currency, d.total)}</td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setViewing({ id: d.id, number: d.invoice_number })}
                          className="text-xs font-medium text-slate-600 hover:underline"
                        >
                          View
                        </button>
                        <Button
                          size="sm"
                          loading={busy === `draft:${d.id}`}
                          disabled={pending}
                          onClick={() => run(`draft:${d.id}`, () => sendDraftInvoice(d.id), () => `${d.invoice_number} sent.`)}
                        >
                          <Send className="h-3.5 w-3.5" /> Send
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      {/* ── Settings ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-900">Settings</h2>
        </CardHeader>
        <CardBody>
          <form
            className="space-y-6"
            action={(fd) => run("save", () => saveBillingSettings(fd), () => "Settings saved.")}
          >
            <fieldset disabled={!settings.migrated} className="space-y-6 disabled:opacity-60">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <Checkbox id="automation_enabled" name="automation_enabled" defaultChecked={settings.automation_enabled} label="Automation on (master switch)" />
                  <Checkbox id="renewal_invoices" name="renewal_invoices" defaultChecked={settings.renewal_invoices} label="Create renewal invoices for subscriptions" />
                  <Checkbox
                    id="auto_send_invoices"
                    name="auto_send_invoices"
                    defaultChecked={settings.auto_send_invoices}
                    label="Email new renewal invoices straight away (off = keep as drafts for me to send)"
                  />
                  <Checkbox id="attach_pdf" name="attach_pdf" defaultChecked={settings.attach_pdf} label="Attach the invoice PDF to emails" />
                </div>
                <div>
                  <Label htmlFor="renewal_days_before">Create the invoice this many days before renewal</Label>
                  <Input id="renewal_days_before" name="renewal_days_before" type="number" min={1} max={60} defaultValue={settings.renewal_days_before} />
                  <p className="mt-1 text-xs text-slate-500">
                    The invoice is due on the renewal date. Due-soon reminders (3 days before) and overdue notices go out as they do today.
                  </p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700">VAT</h3>
                {settings.vatReady ? (
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                      <Checkbox id="vat_enabled" name="vat_enabled" defaultChecked={settings.vat_enabled} label="Charge VAT on renewal invoices" />
                      <Checkbox
                        id="prices_include_vat"
                        name="prices_include_vat"
                        defaultChecked={settings.prices_include_vat}
                        label="Subscription prices already include VAT"
                      />
                      <p className="text-xs text-slate-500">
                        Unticked, VAT is added on top: KES 5,000 becomes 5,000 + {(5000 * Number(settings.vat_rate)) / 100} VAT. Ticked, KES 5,000 is
                        the total with VAT inside it. Manual invoices have their own “Add VAT” box, ticked by default while this is on.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="vat_rate">VAT rate (%)</Label>
                      <Input id="vat_rate" name="vat_rate" type="number" step="0.01" min={0} max={100} defaultValue={settings.vat_rate} />
                      <p className="mt-1 text-xs text-slate-500">Kenya&apos;s standard rate is 16%. Invoices show it as “VAT (16%)” with the KRA PIN.</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-amber-800">
                    Run <code className="font-mono">supabase/migrations/027_billing_vat.sql</code> to turn VAT on. Until then invoices carry no VAT unless typed by hand.
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700">Automatic suspension</h3>
                {settings.suspendReady ? (
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    <div className="space-y-3">
                      <Checkbox
                        id="auto_suspend"
                        name="auto_suspend"
                        defaultChecked={settings.auto_suspend}
                        label="Suspend websites automatically when a subscription invoice stays unpaid"
                      />
                      <p className="text-xs text-slate-500">
                        A website is suspended once its invoice is past due by the subscription&apos;s grace period — and only if a
                        final notice reached the client at least the notice period before. No email on file means no suspension;
                        you are notified instead. Paying in full brings the site back automatically. Turn it off per client under
                        Subscriptions below.
                      </p>
                      <div>
                        <Label htmlFor="suspension_notice_days">Final notice, days before suspension</Label>
                        <Input
                          id="suspension_notice_days"
                          name="suspension_notice_days"
                          type="number"
                          min={1}
                          max={30}
                          defaultValue={settings.suspension_notice_days}
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="suspension_message">Message shown on the client&apos;s site while suspended</Label>
                      <Textarea id="suspension_message" name="suspension_message" defaultValue={settings.suspension_message} className="min-h-[90px]" />
                      <p className="mt-1 text-xs text-slate-500">Visitors to the website see this; the reason (an unpaid invoice) stays in the admin.</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-amber-800">
                    Run <code className="font-mono">supabase/migrations/028_auto_suspend.sql</code> to turn this on.
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700">Payment details on emails and PDFs</h3>
                <p className="text-xs text-slate-500">The same as EDOS Poa&apos;s invoices. Leave a field blank to leave it off.</p>
                <div className="mt-3 grid gap-4 md:grid-cols-3">
                  <Field name="mpesa_paybill" label="M-Pesa Paybill" value={settings.mpesa_paybill} />
                  <Field name="mpesa_account" label="Paybill account number" value={settings.mpesa_account} hint="Blank uses the invoice number" />
                  <Field name="mpesa_till" label="M-Pesa Till" value={settings.mpesa_till} />
                  <Field name="bank_name" label="Bank" value={settings.bank_name} />
                  <Field name="bank_account" label="Bank account number" value={settings.bank_account} />
                  <Field name="bank_branch" label="Branch" value={settings.bank_branch} />
                  <div className="md:col-span-2">
                    <Field name="bank_holder" label="Account name" value={settings.bank_holder} />
                  </div>
                  <Field name="kra_pin" label="KRA PIN" value={settings.kra_pin} />
                </div>
                <div className="mt-4">
                  <Label htmlFor="payment_note">Extra note (optional)</Label>
                  <Textarea id="payment_note" name="payment_note" defaultValue={settings.payment_note ?? ""} className="min-h-[70px]" />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field name="reply_to_email" label="Replies go to" value={settings.reply_to_email} type="email" />
                <Field name="bcc_email" label="Send EDOS a copy of every email (optional)" value={settings.bcc_email} type="email" />
              </div>
            </fieldset>
            <Button type="submit" loading={busy === "save"} disabled={pending || !settings.migrated}>
              Save settings
            </Button>
          </form>
        </CardBody>
      </Card>

      {/* ── Test ──────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-900">Send me a test</h2>
          <p className="text-sm text-slate-500">A real invoice&apos;s email, sent to your own address instead of the client&apos;s.</p>
        </CardHeader>
        <CardBody className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Label htmlFor="test_invoice">Invoice</Label>
            <Select id="test_invoice" value={testInvoice} onChange={(e) => setTestInvoice(e.target.value)}>
              {recentInvoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_number} — {i.edoscentreadmin_clients?.company_name ?? "Client"} ({i.status})
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[200px]">
            <Label htmlFor="test_kind">Email</Label>
            <Select id="test_kind" value={testKind} onChange={(e) => setTestKind(e.target.value as InvoiceEmailKind)}>
              <option value="new_invoice">New invoice</option>
              <option value="reminder_due_soon">Due-soon reminder</option>
              <option value="reminder_overdue">Overdue notice</option>
              <option value="payment_received">Payment receipt</option>
              <option value="suspension_notice">Final notice before suspension</option>
              <option value="website_suspended">Website suspended</option>
            </Select>
          </div>
          <Button
            variant="secondary"
            loading={busy === "test"}
            disabled={pending || !testInvoice}
            onClick={() => run("test", () => sendTestBillingEmail(testInvoice, testKind), (to) => `Test sent to ${to}.`)}
          >
            <Mail className="h-4 w-4" /> Send test to me
          </Button>
        </CardBody>
      </Card>

      {/* ── Subscriptions ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-900">Subscriptions</h2>
          <p className="text-sm text-slate-500">Turn automatic invoices off for one client, or invoice the next period now.</p>
        </CardHeader>
        <CardBody>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="pb-2 font-medium">Website</th>
                <th className="pb-2 font-medium">Renews</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Automatic invoices</th>
                {settings.suspendReady && <th className="pb-2 font-medium">Auto-suspend</th>}
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {subscriptions.map((s) => {
                const auto = s.auto_invoice !== false;
                const suspendOn = s.auto_suspend !== false;
                return (
                  <tr key={s.id}>
                    <td className="py-2 pr-3">
                      <div className="font-medium text-slate-900">{s.edoscentreadmin_websites?.name ?? "—"}</div>
                      <div className="text-xs text-slate-500">
                        {s.edoscentreadmin_clients?.company_name} · {s.edoscentreadmin_clients?.email ?? <span className="text-amber-700">no email</span>}
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-slate-600">{date(s.renewal_date)}</td>
                    <td className="py-2 pr-3">{money(s.currency, s.amount)} / {s.billing_cycle}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="py-2 pr-3">
                      {!s.auto_renew ? (
                        <span className="text-xs text-slate-500">Auto-renew off</span>
                      ) : (
                        <button
                          type="button"
                          disabled={pending || !settings.migrated}
                          onClick={() =>
                            run(`auto:${s.id}`, () => setSubscriptionAutoInvoice(s.id, !auto), () => (auto ? "Automatic invoices off for this subscription." : "Automatic invoices on for this subscription."))
                          }
                          className={`inline-flex items-center gap-1 text-xs font-medium ${auto ? "text-emerald-700" : "text-slate-500"} disabled:opacity-50`}
                        >
                          {auto ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          {auto ? "On" : "Off"}
                        </button>
                      )}
                    </td>
                    {settings.suspendReady && (
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            run(`suspend:${s.id}`, () => setSubscriptionAutoSuspend(s.id, !suspendOn), () =>
                              suspendOn ? "This website will never be suspended automatically." : "Automatic suspension on for this website.",
                            )
                          }
                          className={`inline-flex items-center gap-1 text-xs font-medium ${suspendOn ? "text-emerald-700" : "text-slate-500"} disabled:opacity-50`}
                          title={`Grace period: ${s.grace_period_days ?? 7} days after the due date`}
                        >
                          {suspendOn ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          {suspendOn ? `On · ${s.grace_period_days ?? 7}d grace` : "Never"}
                        </button>
                      </td>
                    )}
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === `now:${s.id}`}
                        disabled={pending || !settings.migrated || !s.renewal_date}
                        onClick={() =>
                          run(`now:${s.id}`, () => createRenewalInvoiceNow(s.id), (x) =>
                            `${x.invoiceNumber} created${x.status === "draft" ? " as a draft" : x.emailed ? " and emailed" : ""}.`,
                          )
                        }
                      >
                        Invoice now
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {/* ── Log ───────────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-slate-900">Email log</h2>
          <p className="text-sm text-slate-500">Every billing email sent, skipped or failed — newest first.</p>
        </CardHeader>
        <CardBody>
          {log.length === 0 ? (
            <p className="text-sm text-slate-500">{settings.migrated ? "No billing emails yet." : "The log starts once migration 026 is run."}</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {log.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3 text-xs text-slate-500">{new Date(l.created_at).toLocaleString("en-GB")}</td>
                    <td className="py-2 pr-3">
                      {KIND_LABEL[l.kind] ?? l.kind}
                      {l.is_test && <span className="ml-1 text-xs text-slate-400">(test)</span>}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{l.invoice_number ?? "—"}</td>
                    <td className="py-2 pr-3 text-slate-600">{l.recipient ?? "—"}</td>
                    <td className="py-2 text-right">
                      <span
                        className={`text-xs font-medium ${l.status === "sent" ? "text-emerald-700" : l.status === "failed" ? "text-red-700" : "text-amber-700"}`}
                      >
                        {l.status}
                      </span>
                      {l.reason && <div className="text-xs text-slate-500">{l.reason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <InvoiceViewer invoiceId={viewing?.id ?? null} invoiceNumber={viewing?.number} onClose={() => setViewing(null)} />
    </div>
  );
}

type RenewalInvoiceOption = RecentInvoice;

function Field({ name, label, value, hint, type = "text" }: { name: string; label: string; value: string | null; hint?: string; type?: string }) {
  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type={type} defaultValue={value ?? ""} />
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function InvoiceList({ rows, empty }: { rows: InvoiceLite[]; empty: string }) {
  if (!rows.length) return <p className="mt-2 text-sm text-slate-500">{empty}</p>;
  return (
    <table className="mt-2 w-full text-sm">
      <tbody className="divide-y divide-slate-100">
        {rows.map((i) => (
          <tr key={i.id}>
            <td className="py-2 pr-3">
              <span className="font-mono text-xs text-slate-500">{i.invoice_number}</span>{" "}
              <span className="text-slate-900">{i.edoscentreadmin_clients?.company_name}</span>
              <div className="text-xs text-slate-500">{i.edoscentreadmin_clients?.email ?? <span className="text-amber-700">no email on file</span>}</div>
            </td>
            <td className="py-2 pr-3 text-slate-600">Due {date(i.due_date)}</td>
            <td className="py-2 text-right font-medium">{money(i.currency, i.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
