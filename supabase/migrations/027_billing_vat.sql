-- ============================================================================
-- 027 — VAT on invoices, switched on and off from Billing automation.
--
-- Additive: three settings on the existing billing settings row. Off by
-- default, so no invoice changes until an admin turns VAT on. Invoices already
-- carry `tax`; this only decides when the app fills it in.
--
--   vat_enabled         Charge VAT on renewal invoices, and tick "Add VAT" by
--                       default on a new manual invoice.
--   vat_rate            Percent. Kenya's standard rate is 16.
--   prices_include_vat  TRUE when a subscription's amount already includes
--                       VAT (KES 5,000 = 4,310.34 + 689.66 VAT); FALSE adds
--                       VAT on top (KES 5,000 + 800 = 5,800).
-- ============================================================================

ALTER TABLE edoscentreadmin_billing_settings
  ADD COLUMN IF NOT EXISTS vat_enabled        BOOLEAN       NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS vat_rate           NUMERIC(5,2)  NOT NULL DEFAULT 16 CHECK (vat_rate >= 0 AND vat_rate <= 100),
  ADD COLUMN IF NOT EXISTS prices_include_vat BOOLEAN       NOT NULL DEFAULT FALSE;

-- Verification
--   select vat_enabled, vat_rate, prices_include_vat from edoscentreadmin_billing_settings;
--   -- false, 16.00, false
