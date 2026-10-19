-- ============================================================================
-- 026 — Billing automation: renewal invoices and client emails, run from the
-- admin's Billing automation page.
--
-- Additive only. Nothing existing changes meaning:
--   * The daily sweep's current work (subscription states, overdue invoices,
--     the 3-day and overdue reminders, admin notifications) is untouched.
--   * The new work — creating renewal invoices for subscriptions — runs only
--     when switched on in the settings row below, which starts switched OFF.
--   * Manual invoices, payments, M-Pesa and the renewal cascade are unchanged.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings — exactly one row, edited on /admin/billing-automation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edoscentreadmin_billing_settings (
  id                    SMALLINT    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- Master switch for the new automation. Off until the admin turns it on.
  automation_enabled    BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Create the next period's invoice this many days before renewal_date.
  renewal_invoices      BOOLEAN     NOT NULL DEFAULT TRUE,
  renewal_days_before   INT         NOT NULL DEFAULT 7 CHECK (renewal_days_before BETWEEN 1 AND 60),
  -- FALSE keeps a new renewal invoice as a draft for the admin to check and
  -- send; TRUE marks it sent and emails it to the client straight away.
  auto_send_invoices    BOOLEAN     NOT NULL DEFAULT FALSE,
  -- Printed on emails and PDFs. The same fields, and to start with the same
  -- values, as EDOS Poa's platform account (Settings → Payment details there),
  -- so a client sees one set of payment details from EDOS whichever system
  -- billed them. Editable on the admin page.
  mpesa_paybill         TEXT,
  mpesa_account         TEXT,
  mpesa_till            TEXT,
  bank_name             TEXT,
  bank_account          TEXT,
  bank_holder           TEXT,
  bank_branch           TEXT,
  kra_pin               TEXT,
  payment_note          TEXT,
  -- Where a client's reply goes, and an optional copy of every email to EDOS.
  reply_to_email        TEXT,
  bcc_email             TEXT,
  attach_pdf            BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            UUID        REFERENCES edoscentreadmin_admin_users(id) ON DELETE SET NULL
);

-- Seeded from EDOS Poa's platform account as it stood on 2026-10-19.
INSERT INTO edoscentreadmin_billing_settings
  (id, mpesa_paybill, mpesa_account, bank_name, bank_account, bank_holder, bank_branch, kra_pin, reply_to_email)
VALUES
  (1, '600100', '188110', 'Stanbic Bank Kenya', '0100018818811',
   'EMBRACE DATA FOR OPTIMUM SOLUTIONS CENTRE LIMITED', 'Kisumu', 'P052570047Z', 'info@edoscentre.co.ke')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE edoscentreadmin_billing_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eca_billing_settings_admin_all ON edoscentreadmin_billing_settings;
CREATE POLICY eca_billing_settings_admin_all ON edoscentreadmin_billing_settings
  FOR ALL USING (edoscentreadmin_is_admin()) WITH CHECK (edoscentreadmin_is_admin());

-- ---------------------------------------------------------------------------
-- 2. Email log — every client email the billing code sends, or skips, and why
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edoscentreadmin_billing_email_log (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id      UUID        REFERENCES edoscentreadmin_invoices(id) ON DELETE SET NULL,
  invoice_number  TEXT,
  kind            TEXT        NOT NULL,
  recipient       TEXT,
  status          TEXT        NOT NULL CHECK (status IN ('sent','skipped','failed')),
  reason          TEXT,
  is_test         BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eca_billing_email_log_created ON edoscentreadmin_billing_email_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eca_billing_email_log_invoice ON edoscentreadmin_billing_email_log (invoice_id);

ALTER TABLE edoscentreadmin_billing_email_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eca_billing_email_log_admin_read ON edoscentreadmin_billing_email_log;
CREATE POLICY eca_billing_email_log_admin_read ON edoscentreadmin_billing_email_log
  FOR SELECT USING (edoscentreadmin_is_admin());
-- Written only by the server with the service role; no insert policy for users.

-- ---------------------------------------------------------------------------
-- 3. One invoice per renewal period
--
--    renewal_period_start is the renewal_date the invoice bills for. The
--    partial unique index means a sweep run twice, or two runs overlapping,
--    cannot invoice the same subscription for the same period twice.
--    Invoices made by hand leave it null and are unaffected.
-- ---------------------------------------------------------------------------
ALTER TABLE edoscentreadmin_invoices
  ADD COLUMN IF NOT EXISTS renewal_period_start DATE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_eca_invoices_subscription_period
  ON edoscentreadmin_invoices (subscription_id, renewal_period_start)
  WHERE subscription_id IS NOT NULL AND renewal_period_start IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Per-subscription opt-out
--
--    TRUE (the default) lets the automation invoice this subscription when it
--    is switched on. An admin can turn it off for one client — one billed
--    another way, say — without touching anyone else.
-- ---------------------------------------------------------------------------
ALTER TABLE edoscentreadmin_subscriptions
  ADD COLUMN IF NOT EXISTS auto_invoice BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
--   select automation_enabled from edoscentreadmin_billing_settings;  -- false
--   select count(*) from edoscentreadmin_invoices where renewal_period_start is not null;  -- 0
