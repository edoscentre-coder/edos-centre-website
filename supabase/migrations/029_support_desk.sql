-- ============================================================================
-- 029 — Support desk: requests clients raise from the portal, answered in the
-- admin.
--
-- Additive: two new tables, a numbering sequence and a function. Nothing
-- existing changes.
--
--   edoscentreadmin_support_tickets   one request: client, website, subject,
--                                     category, priority, status.
--   edoscentreadmin_support_messages  the conversation on it. is_internal
--                                     rows are admin notes the client never
--                                     sees.
--
-- Writes go through the server (service role) after it has checked who is
-- asking, the same arrangement as invoices. RLS lets admins read everything
-- and a portal user read only their own client's tickets and the non-internal
-- messages on them.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS edoscentreadmin_support_ticket_seq START 1;

CREATE TABLE IF NOT EXISTS edoscentreadmin_support_tickets (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number         TEXT        NOT NULL UNIQUE,
  client_id             UUID        NOT NULL REFERENCES edoscentreadmin_clients(id) ON DELETE CASCADE,
  website_id            UUID        REFERENCES edoscentreadmin_websites(id) ON DELETE SET NULL,
  subject               TEXT        NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  category              TEXT        NOT NULL DEFAULT 'other'
                          CHECK (category IN ('change_request','bug','billing','other')),
  priority              TEXT        NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('low','normal','high','urgent')),
  status                TEXT        NOT NULL DEFAULT 'open'
                          CHECK (status IN ('open','waiting_on_client','resolved')),
  opened_by_portal_user UUID        REFERENCES edoscentreadmin_client_portal_users(id) ON DELETE SET NULL,
  opened_by_admin       UUID        REFERENCES edoscentreadmin_admin_users(id) ON DELETE SET NULL,
  last_message_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_eca_support_tickets_client ON edoscentreadmin_support_tickets (client_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_eca_support_tickets_status ON edoscentreadmin_support_tickets (status, last_message_at DESC);

DROP TRIGGER IF EXISTS trg_eca_support_tickets_updated_at ON edoscentreadmin_support_tickets;
CREATE TRIGGER trg_eca_support_tickets_updated_at
  BEFORE UPDATE ON edoscentreadmin_support_tickets
  FOR EACH ROW EXECUTE FUNCTION edoscentreadmin_set_updated_at();

CREATE TABLE IF NOT EXISTS edoscentreadmin_support_messages (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id             UUID        NOT NULL REFERENCES edoscentreadmin_support_tickets(id) ON DELETE CASCADE,
  author_type           TEXT        NOT NULL CHECK (author_type IN ('client','admin')),
  author_admin_id       UUID        REFERENCES edoscentreadmin_admin_users(id) ON DELETE SET NULL,
  author_portal_user_id UUID        REFERENCES edoscentreadmin_client_portal_users(id) ON DELETE SET NULL,
  author_name           TEXT,
  body                  TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  is_internal           BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- A client never writes an internal note.
  CHECK (NOT (author_type = 'client' AND is_internal))
);

CREATE INDEX IF NOT EXISTS idx_eca_support_messages_ticket ON edoscentreadmin_support_messages (ticket_id, created_at);

-- SUP-2026-0001: one run across all clients, like invoice numbers (011).
CREATE OR REPLACE FUNCTION edoscentreadmin_next_ticket_number()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'SUP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('edoscentreadmin_support_ticket_seq')::text, 4, '0');
$$;

REVOKE EXECUTE ON FUNCTION edoscentreadmin_next_ticket_number() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION edoscentreadmin_next_ticket_number() TO service_role;

ALTER TABLE edoscentreadmin_support_tickets  ENABLE ROW LEVEL SECURITY;
ALTER TABLE edoscentreadmin_support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eca_support_tickets_read ON edoscentreadmin_support_tickets;
CREATE POLICY eca_support_tickets_read ON edoscentreadmin_support_tickets
  FOR SELECT USING (edoscentreadmin_is_admin() OR client_id = edoscentreadmin_current_client_id());

DROP POLICY IF EXISTS eca_support_tickets_admin_write ON edoscentreadmin_support_tickets;
CREATE POLICY eca_support_tickets_admin_write ON edoscentreadmin_support_tickets
  FOR ALL USING (edoscentreadmin_is_admin()) WITH CHECK (edoscentreadmin_is_admin());

DROP POLICY IF EXISTS eca_support_messages_read ON edoscentreadmin_support_messages;
CREATE POLICY eca_support_messages_read ON edoscentreadmin_support_messages
  FOR SELECT USING (
    edoscentreadmin_is_admin()
    OR (
      NOT is_internal
      AND EXISTS (
        SELECT 1 FROM edoscentreadmin_support_tickets t
        WHERE t.id = ticket_id AND t.client_id = edoscentreadmin_current_client_id()
      )
    )
  );

DROP POLICY IF EXISTS eca_support_messages_admin_write ON edoscentreadmin_support_messages;
CREATE POLICY eca_support_messages_admin_write ON edoscentreadmin_support_messages
  FOR ALL USING (edoscentreadmin_is_admin()) WITH CHECK (edoscentreadmin_is_admin());

REVOKE ALL ON edoscentreadmin_support_tickets  FROM anon;
REVOKE ALL ON edoscentreadmin_support_messages FROM anon;

-- Verification
--   select count(*) from edoscentreadmin_support_tickets;  -- 0
