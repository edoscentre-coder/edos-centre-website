-- ============================================================================
-- 028 — Automatic suspension of websites whose subscription invoice is unpaid.
--
-- Additive, and off by default. Nothing is suspended until an admin turns on
-- "Suspend websites automatically" under Billing automation (and the master
-- switch is on).
--
-- When on, for an unpaid invoice linked to a subscription and a website:
--   due date + the subscription's grace period = the suspension date;
--   suspension_notice_days before it, a final notice is emailed, once;
--   on the date — and only if that notice went out at least that many days
--   earlier — the website is suspended and the client emailed.
-- Paying the invoice in full reactivates the site through the existing
-- payment cascade, unchanged.
-- ============================================================================

ALTER TABLE edoscentreadmin_billing_settings
  ADD COLUMN IF NOT EXISTS auto_suspend            BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspension_notice_days  INT     NOT NULL DEFAULT 3 CHECK (suspension_notice_days BETWEEN 1 AND 30),
  -- Shown on the client's own site while it is suspended.
  ADD COLUMN IF NOT EXISTS suspension_message      TEXT    NOT NULL DEFAULT 'This website is temporarily unavailable. Please check back soon.';

-- One-shot markers, like reminder_sent_at and overdue_notice_sent_at (025).
ALTER TABLE edoscentreadmin_invoices
  ADD COLUMN IF NOT EXISTS suspension_notice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspended_at              TIMESTAMPTZ;

-- Per-client opt-out: FALSE means never suspend this subscription's website
-- automatically, whatever the global switch says.
ALTER TABLE edoscentreadmin_subscriptions
  ADD COLUMN IF NOT EXISTS auto_suspend BOOLEAN NOT NULL DEFAULT TRUE;

-- Verification
--   select auto_suspend, suspension_notice_days from edoscentreadmin_billing_settings;  -- false, 3
