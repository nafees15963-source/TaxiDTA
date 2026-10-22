-- Nonce-only Supabase setup proof. No patients, invoices, bank data or DTA payloads.
-- Created using Supabase CLI 2.121.0 `migration new owner_mfa_setup_probe`.
-- Execute this reviewed migration alone; future financial schemas remain under docs/drafts/.
BEGIN;
CREATE SCHEMA IF NOT EXISTS taxidta;
REVOKE ALL ON SCHEMA taxidta FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA taxidta TO authenticated;

CREATE TABLE IF NOT EXISTS taxidta.owner_account (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT
);
ALTER TABLE taxidta.owner_account ENABLE ROW LEVEL SECURITY;
-- SQL administrator/table-owner is the trust boundary. Clients receive no grants/policies.
-- NO FORCE is deliberate so the private SECURITY DEFINER guard can read its own table,
-- without assuming that the deployment role has BYPASSRLS. This does not grant a client access.
ALTER TABLE taxidta.owner_account NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE taxidta.owner_account FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION taxidta.is_owner_mfa() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
 SELECT coalesce(auth.uid() IS NOT NULL
  AND (auth.jwt()->>'aal') = 'aal2'
  AND EXISTS (SELECT 1 FROM taxidta.owner_account AS o WHERE o.user_id = auth.uid())
  AND EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = auth.uid()
    AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL
    AND (u.banned_until IS NULL OR u.banned_until <= now()))
  AND CASE WHEN (auth.jwt()->>'session_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   THEN EXISTS (
    SELECT 1 FROM auth.sessions AS s
     WHERE s.id = (auth.jwt()->>'session_id')::uuid AND s.user_id = auth.uid()
      AND (s.not_after IS NULL OR s.not_after > now())
   ) ELSE false END, false)
$$;
REVOKE ALL ON FUNCTION taxidta.is_owner_mfa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION taxidta.is_owner_mfa() TO authenticated;

CREATE TABLE IF NOT EXISTS taxidta.setup_connection_probes (
  probe_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS setup_connection_probes_owner_created
 ON taxidta.setup_connection_probes(owner_id, created_at);
ALTER TABLE taxidta.setup_connection_probes ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxidta.setup_connection_probes NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE taxidta.setup_connection_probes FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS owner_mfa_probe_read ON taxidta.setup_connection_probes;
CREATE POLICY owner_mfa_probe_read ON taxidta.setup_connection_probes
 FOR SELECT TO authenticated USING (owner_id = (select auth.uid()) AND (select taxidta.is_owner_mfa()));
-- No direct client table grants. No client INSERT/UPDATE/DELETE policies.

-- Genuinely privileged code stays in the NON-EXPOSED taxidta schema. Every operation
-- repeats the owner+AAL2+live-session check; no caller-controlled authorization claims.
CREATE OR REPLACE FUNCTION taxidta.setup_probe(p_operation text, p_probe_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $$ DECLARE probe taxidta.setup_connection_probes; BEGIN
 IF taxidta.is_owner_mfa() IS NOT TRUE THEN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Owner session with AAL2 and active session required';
 END IF;
 IF p_operation = 'status' THEN
  RETURN pg_catalog.jsonb_build_object('schemaVersion', 'taxidta-setup-probe-v1', 'syntheticOnly', true, 'ownerAccess', true, 'aal', 'aal2');
 END IF;
 IF p_probe_id IS NULL THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Probe UUID required';
 END IF;
 IF p_operation = 'write' THEN
  DELETE FROM taxidta.setup_connection_probes AS p
   WHERE p.owner_id = auth.uid() AND p.created_at < now() - interval '24 hours';
  INSERT INTO taxidta.setup_connection_probes(probe_id, owner_id)
   VALUES (p_probe_id, auth.uid()) ON CONFLICT(probe_id) DO NOTHING;
  SELECT p.* INTO probe FROM taxidta.setup_connection_probes AS p
   WHERE p.probe_id = p_probe_id AND p.owner_id = auth.uid();
  IF NOT FOUND THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Probe belongs to another owner';
  END IF;
  RETURN pg_catalog.jsonb_build_object('schemaVersion', 'taxidta-setup-probe-v1', 'syntheticOnly', true, 'probeId', probe.probe_id, 'createdAt', probe.created_at);
 ELSIF p_operation = 'read' THEN
  SELECT p.* INTO probe FROM taxidta.setup_connection_probes AS p
   WHERE p.probe_id = p_probe_id AND p.owner_id = auth.uid();
  IF NOT FOUND THEN
   RETURN pg_catalog.jsonb_build_object('schemaVersion', 'taxidta-setup-probe-v1', 'syntheticOnly', true, 'probeId', p_probe_id, 'found', false);
  END IF;
  RETURN pg_catalog.jsonb_build_object('schemaVersion', 'taxidta-setup-probe-v1', 'syntheticOnly', true, 'probeId', probe.probe_id, 'createdAt', probe.created_at, 'found', true);
 ELSIF p_operation = 'delete' THEN
  IF EXISTS (SELECT 1 FROM taxidta.setup_connection_probes AS p WHERE p.probe_id = p_probe_id AND p.owner_id <> auth.uid()) THEN
   RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Probe belongs to another owner';
  END IF;
  DELETE FROM taxidta.setup_connection_probes AS p WHERE p.probe_id = p_probe_id AND p.owner_id = auth.uid();
  RETURN pg_catalog.jsonb_build_object('schemaVersion', 'taxidta-setup-probe-v1', 'syntheticOnly', true, 'probeId', p_probe_id,
   'removed', NOT EXISTS (SELECT 1 FROM taxidta.setup_connection_probes AS p WHERE p.probe_id = p_probe_id));
 END IF;
 RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported setup operation';
END $$;
REVOKE ALL ON FUNCTION taxidta.setup_probe(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION taxidta.setup_probe(text, uuid) TO authenticated;

-- Exposed RPCs are fixed SECURITY INVOKER wrappers, never public SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.taxidta_setup_probe_status() RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT taxidta.setup_probe('status', NULL) $$;
CREATE OR REPLACE FUNCTION public.taxidta_setup_probe_write(p_probe_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT taxidta.setup_probe('write', p_probe_id) $$;
CREATE OR REPLACE FUNCTION public.taxidta_setup_probe_read(p_probe_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT taxidta.setup_probe('read', p_probe_id) $$;
CREATE OR REPLACE FUNCTION public.taxidta_setup_probe_delete(p_probe_id uuid) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = ''
AS $$ SELECT taxidta.setup_probe('delete', p_probe_id) $$;
REVOKE ALL ON FUNCTION public.taxidta_setup_probe_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.taxidta_setup_probe_write(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.taxidta_setup_probe_read(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.taxidta_setup_probe_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.taxidta_setup_probe_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.taxidta_setup_probe_write(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.taxidta_setup_probe_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.taxidta_setup_probe_delete(uuid) TO authenticated;
COMMIT;

-- Bind the independently verified owner UUID through a separate trusted administrator step.
-- No client signup / claim-owner RPC exists. Do not auto-replace an existing owner.
-- Disable public signup separately; this SQL does not configure Auth settings, region,
-- consent, storage, MFA enrollment, backup or production health-data approval.
