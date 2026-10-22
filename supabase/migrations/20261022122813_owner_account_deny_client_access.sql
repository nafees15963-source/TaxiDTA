-- Additive hardening after the initial applied setup-probe migration.
-- Created using Supabase CLI 2.121.0 migration new owner_account_deny_client_access.
-- Explicit restrictive denial documents default-deny without granting any table access.
BEGIN;
ALTER TABLE taxidta.owner_account ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE taxidta.owner_account FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS owner_account_deny_client_access ON taxidta.owner_account;
CREATE POLICY owner_account_deny_client_access ON taxidta.owner_account
 AS RESTRICTIVE FOR ALL TO authenticated
 USING (false) WITH CHECK (false);
-- NO FORCE from the reviewed initial migration remains unchanged: the trusted table
-- owner may read this internal binding inside its fixed SECURITY DEFINER guard.
COMMIT;
