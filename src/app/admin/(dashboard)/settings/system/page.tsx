import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/admin/ui/Card";
import { getBillingSettings } from "@/lib/admin/billing-settings";
import { createServiceClient } from "@/lib/supabase/server";

export const metadata = { title: "System status — Settings — EDOS Control Centre" };
export const dynamic = "force-dynamic";

/**
 * What is configured and what is not, in one look — the questions that
 * otherwise mean opening Vercel and Supabase: will emails send, will the daily
 * check run, is M-Pesa live, have the migrations been run. Shows whether each
 * secret is set, never its value.
 */

const AUTOMATION_ACTIONS = [
  "subscription_auto_status",
  "invoice_auto_overdue",
  "invoice_reminder_emailed",
  "renewal_invoice_created",
  "suspension_notice_emailed",
  "website_auto_suspended",
  "billing_sweep_run_manually",
];

type Check = { label: string; ok: boolean; detail: string };

const set = (name: string) => Boolean(process.env[name]?.trim());
const when = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

export default async function SystemStatusPage() {
  const supabase = await createServiceClient();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [billing, lastRun, failures, support] = await Promise.all([
    getBillingSettings(),
    supabase
      .from("edoscentreadmin_audit_logs")
      .select("created_at, action")
      .in("action", AUTOMATION_ACTIONS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("edoscentreadmin_billing_email_log")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", weekAgo),
    supabase.from("edoscentreadmin_support_tickets").select("id", { count: "exact", head: true }),
  ]);

  const mpesaKeys = ["MPESA_CONSUMER_KEY", "MPESA_CONSUMER_SECRET", "MPESA_SHORTCODE", "MPESA_PASSKEY", "MPESA_CALLBACK_URL"];
  const mpesaMissing = mpesaKeys.filter((k) => !set(k));
  const mpesaLive = process.env.MPESA_ENV === "production";

  const groups: { title: string; checks: Check[] }[] = [
    {
      title: "Email",
      checks: [
        {
          label: "Sending (Resend)",
          ok: set("RESEND_API_KEY") && set("RESEND_FROM_EMAIL"),
          detail:
            set("RESEND_API_KEY") && set("RESEND_FROM_EMAIL")
              ? `Sending from ${process.env.RESEND_FROM_EMAIL}. The domain must be verified in Resend.`
              : "Set RESEND_API_KEY and RESEND_FROM_EMAIL in Vercel. Until then no client or admin email is sent.",
        },
        {
          label: "Failed billing emails, last 7 days",
          ok: (failures.count ?? 0) === 0,
          detail: failures.error ? "Email log not available (migration 026)." : `${failures.count ?? 0} failed — see the email log under Billing & email.`,
        },
      ],
    },
    {
      title: "Daily check",
      checks: [
        {
          label: "Schedule (CRON_SECRET)",
          ok: set("CRON_SECRET"),
          detail: set("CRON_SECRET")
            ? "Runs daily at 06:00 UTC (09:00 Nairobi) — see Vercel → Settings → Cron Jobs."
            : "Set CRON_SECRET in Vercel and redeploy, or the daily check never runs.",
        },
        {
          label: "Last automatic activity",
          ok: Boolean(lastRun.data),
          detail: lastRun.data
            ? `${when(lastRun.data.created_at)} — ${lastRun.data.action.replace(/_/g, " ")}`
            : "Nothing recorded yet. A quiet day leaves no entry, so this can be blank while all is well.",
        },
      ],
    },
    {
      title: "Payments",
      checks: [
        {
          label: "M-Pesa (STK push)",
          ok: mpesaMissing.length === 0,
          detail:
            mpesaMissing.length === 0
              ? `${mpesaLive ? "Production" : "Sandbox — test payments only"} (MPESA_ENV=${process.env.MPESA_ENV ?? "sandbox"}).`
              : `Missing: ${mpesaMissing.join(", ")}.`,
        },
        {
          label: "Site address (NEXT_PUBLIC_SITE_URL)",
          ok: set("NEXT_PUBLIC_SITE_URL"),
          detail: process.env.NEXT_PUBLIC_SITE_URL ?? "Not set — invoice links in emails fall back to the default address.",
        },
      ],
    },
    {
      title: "Database migrations",
      checks: [
        { label: "026 — Billing automation", ok: billing.migrated, detail: billing.migrated ? "Run." : "Not run — settings, renewal invoices and the email log are unavailable." },
        { label: "027 — VAT", ok: billing.vatReady, detail: billing.vatReady ? "Run." : "Not run — VAT cannot be switched on." },
        { label: "028 — Automatic suspension", ok: billing.suspendReady, detail: billing.suspendReady ? "Run." : "Not run — automatic suspension is unavailable." },
        { label: "029 — Support", ok: !support.error, detail: support.error ? "Not run — the Support desk is unavailable." : `Run — ${support.count ?? 0} request(s) so far.` },
      ],
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {groups.map((g) => (
        <Card key={g.title}>
          <CardHeader>
            <h2 className="font-semibold text-slate-900">{g.title}</h2>
          </CardHeader>
          <CardBody>
            <ul className="space-y-3">
              {g.checks.map((c) => (
                <li key={c.label} className="flex items-start gap-3">
                  {c.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="OK" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-label="Needs attention" />
                  )}
                  <div>
                    <div className="text-sm font-medium text-slate-900">{c.label}</div>
                    <div className="text-xs text-slate-500">{c.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
