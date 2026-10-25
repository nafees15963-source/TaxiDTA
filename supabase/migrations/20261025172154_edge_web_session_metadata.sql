-- App-session metadata only. No passwords, TOTP secrets or Supabase tokens are stored here.
-- Created with Supabase CLI `migration new edge_web_session_metadata`.
BEGIN;
CREATE TABLE taxidta.web_sessions (
 nonce_hash text PRIMARY KEY CHECK (nonce_hash ~ '^[a-f0-9]{64}$'),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 auth_session_id uuid NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
 generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL
);
CREATE INDEX web_sessions_owner_expiry ON taxidta.web_sessions(owner_id,expires_at);
ALTER TABLE taxidta.web_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxidta.web_sessions NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE taxidta.web_sessions FROM PUBLIC,anon,authenticated;
CREATE POLICY web_sessions_deny_clients ON taxidta.web_sessions AS RESTRICTIVE FOR ALL TO authenticated USING(false) WITH CHECK(false);
CREATE TABLE taxidta.web_otp_budget (
 owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 window_started_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 6)
);
ALTER TABLE taxidta.web_otp_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxidta.web_otp_budget NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE taxidta.web_otp_budget FROM PUBLIC,anon,authenticated;
CREATE POLICY web_otp_budget_deny_clients ON taxidta.web_otp_budget AS RESTRICTIVE FOR ALL TO authenticated USING(false) WITH CHECK(false);

-- AAL1 is intentionally sufficient for the password-authenticated enrollment boundary,
-- never for financial data. Membership is administrative, never user_metadata.
CREATE FUNCTION taxidta.web_owner_session() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $$ DECLARE session_uuid uuid; BEGIN
 IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'aal','') NOT IN ('aal1','aal2')
 OR NOT EXISTS(SELECT 1 FROM taxidta.owner_account o WHERE o.user_id=auth.uid())
 OR NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id=auth.uid() AND u.deleted_at IS NULL AND u.email_confirmed_at IS NOT NULL AND (u.banned_until IS NULL OR u.banned_until<=now()))
 OR coalesce(auth.jwt()->>'session_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 THEN RETURN NULL; END IF;
 session_uuid := (auth.jwt()->>'session_id')::uuid;
 IF NOT EXISTS(SELECT 1 FROM auth.sessions s WHERE s.id=session_uuid AND s.user_id=auth.uid() AND (s.not_after IS NULL OR s.not_after>now())) THEN RETURN NULL; END IF;
 RETURN session_uuid;
END $$;
REVOKE ALL ON FUNCTION taxidta.web_owner_session() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION taxidta.web_owner_session() TO authenticated;

-- Financial functions call this inside their own transaction. Rotation changes the
-- primary key, so FOR KEY SHARE excludes simultaneous rotation/deletion until commit.
CREATE FUNCTION taxidta.web_session_is_active(p_nonce_sha256 text,p_generation bigint) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $$ DECLARE session_uuid uuid; matched boolean; BEGIN
 session_uuid:=taxidta.web_owner_session();
 IF session_uuid IS NULL OR p_nonce_sha256 IS NULL OR p_nonce_sha256 !~ '^[a-f0-9]{64}$' OR p_generation IS NULL OR p_generation<0 THEN RETURN false; END IF;
 SELECT true INTO matched FROM taxidta.web_sessions s
 WHERE s.nonce_hash=p_nonce_sha256 AND s.generation=p_generation AND s.owner_id=auth.uid() AND s.auth_session_id=session_uuid
 AND s.expires_at>now() AND s.created_at>now()-interval '30 minutes' AND s.last_seen_at>now()-interval '10 minutes'
 FOR KEY SHARE;
 RETURN coalesce(matched,false);
END $$;
REVOKE ALL ON FUNCTION taxidta.web_session_is_active(text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION taxidta.web_session_is_active(text,bigint) TO authenticated;

CREATE FUNCTION taxidta.web_session_operation(p_operation text,p_nonce text,p_generation bigint,p_new_nonce text DEFAULT NULL,p_touch boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $$ DECLARE session_uuid uuid; nonce_digest text; session_row taxidta.web_sessions; budget taxidta.web_otp_budget; token_expiry timestamptz; BEGIN
 session_uuid:=taxidta.web_owner_session();
 IF session_uuid IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Confirmed owner and active Auth session required'; END IF;
 IF p_nonce IS NULL OR p_nonce !~ '^[a-f0-9]{64}$' OR p_generation IS NULL OR p_generation<0 OR p_generation>1000000000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid app session reference'; END IF;
 nonce_digest:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_nonce,'UTF8')),'hex');
 IF p_operation='create' THEN
  IF p_generation<>0 OR coalesce(auth.jwt()->>'exp','') !~ '^[0-9]{1,12}$' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid initial session'; END IF;
  token_expiry:=pg_catalog.to_timestamp((auth.jwt()->>'exp')::double precision)-interval '120 seconds';
  IF token_expiry<=now() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Auth token expiry too close'; END IF;
  DELETE FROM taxidta.web_sessions s WHERE s.owner_id=auth.uid() AND (s.expires_at<=now() OR s.last_seen_at<=now()-interval '10 minutes');
  -- Serialize per owner before counting/creating to keep the session cap real.
  PERFORM 1 FROM taxidta.owner_account o WHERE o.user_id=auth.uid() FOR UPDATE;
  IF (SELECT count(*) FROM taxidta.web_sessions s WHERE s.owner_id=auth.uid())>=100 THEN RAISE EXCEPTION USING ERRCODE='54000',MESSAGE='App session capacity reached'; END IF;
  INSERT INTO taxidta.web_sessions(nonce_hash,owner_id,auth_session_id,expires_at)
  VALUES(nonce_digest,auth.uid(),session_uuid,least(now()+interval '30 minutes',token_expiry)) RETURNING * INTO session_row;
 ELSE
  SELECT s.* INTO session_row FROM taxidta.web_sessions s WHERE s.nonce_hash=nonce_digest AND s.owner_id=auth.uid() AND s.auth_session_id=session_uuid AND s.generation=p_generation FOR UPDATE;
  IF NOT FOUND OR session_row.expires_at<=now() OR session_row.created_at<=now()-interval '30 minutes' OR session_row.last_seen_at<=now()-interval '10 minutes' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='App session expired or revoked'; END IF;
  IF p_operation='delete' THEN
   DELETE FROM taxidta.web_sessions s WHERE s.nonce_hash=nonce_digest;
   RETURN pg_catalog.jsonb_build_object('deleted',true);
  ELSIF p_operation='rotate' THEN
   IF taxidta.is_owner_mfa() IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Verified owner MFA required to rotate'; END IF;
   IF p_new_nonce IS NULL OR p_new_nonce !~ '^[a-f0-9]{64}$' OR p_new_nonce=p_nonce THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Fresh session nonce required'; END IF;
   UPDATE taxidta.web_sessions s SET nonce_hash=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_new_nonce,'UTF8')),'hex'),generation=s.generation+1,last_seen_at=now() WHERE s.nonce_hash=nonce_digest RETURNING * INTO session_row;
  ELSIF p_operation='otp_consume' THEN
   INSERT INTO taxidta.web_otp_budget(owner_id) VALUES(auth.uid()) ON CONFLICT(owner_id) DO NOTHING;
   SELECT b.* INTO budget FROM taxidta.web_otp_budget b WHERE b.owner_id=auth.uid() FOR UPDATE;
   IF budget.window_started_at<=now()-interval '10 minutes' THEN UPDATE taxidta.web_otp_budget b SET window_started_at=now(),attempts=0 WHERE b.owner_id=auth.uid() RETURNING * INTO budget; END IF;
   IF budget.attempts>=6 THEN RETURN pg_catalog.jsonb_build_object('allowed',false); END IF;
   UPDATE taxidta.web_otp_budget b SET attempts=b.attempts+1 WHERE b.owner_id=auth.uid();
   RETURN pg_catalog.jsonb_build_object('allowed',true);
  ELSIF p_operation='otp_reset' THEN
   IF taxidta.is_owner_mfa() IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Verified MFA required to reset attempt budget'; END IF;
   DELETE FROM taxidta.web_otp_budget b WHERE b.owner_id=auth.uid();
   RETURN pg_catalog.jsonb_build_object('reset',true);
  ELSIF p_operation<>'validate' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Unsupported app session operation';
  ELSIF p_touch THEN
   UPDATE taxidta.web_sessions s SET last_seen_at=now() WHERE s.nonce_hash=nonce_digest RETURNING * INTO session_row;
  END IF;
 END IF;
 RETURN pg_catalog.jsonb_build_object('active',true,'generation',session_row.generation,'expiresAt',session_row.expires_at,'lastSeenAt',session_row.last_seen_at);
END $$;
REVOKE ALL ON FUNCTION taxidta.web_session_operation(text,text,bigint,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION taxidta.web_session_operation(text,text,bigint,text,boolean) TO authenticated;

CREATE FUNCTION public.taxidta_web_session_create(p_nonce text,p_generation bigint) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT taxidta.web_session_operation('create',p_nonce,p_generation,NULL,true) $$;
CREATE FUNCTION public.taxidta_web_session_validate(p_nonce text,p_generation bigint,p_touch boolean DEFAULT true) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT taxidta.web_session_operation('validate',p_nonce,p_generation,NULL,p_touch) $$;
CREATE FUNCTION public.taxidta_web_session_rotate(p_nonce text,p_generation bigint,p_new_nonce text) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT taxidta.web_session_operation('rotate',p_nonce,p_generation,p_new_nonce,true) $$;
CREATE FUNCTION public.taxidta_web_session_delete(p_nonce text,p_generation bigint) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT taxidta.web_session_operation('delete',p_nonce,p_generation,NULL,false) $$;
CREATE FUNCTION public.taxidta_web_session_otp_consume(p_nonce text,p_generation bigint) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT taxidta.web_session_operation('otp_consume',p_nonce,p_generation,NULL,false) $$;
CREATE FUNCTION public.taxidta_web_session_otp_reset(p_nonce text,p_generation bigint) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path='' AS $$ SELECT taxidta.web_session_operation('otp_reset',p_nonce,p_generation,NULL,false) $$;
REVOKE ALL ON FUNCTION public.taxidta_web_session_create(text,bigint),public.taxidta_web_session_validate(text,bigint,boolean),public.taxidta_web_session_rotate(text,bigint,text),public.taxidta_web_session_delete(text,bigint),public.taxidta_web_session_otp_consume(text,bigint),public.taxidta_web_session_otp_reset(text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.taxidta_web_session_create(text,bigint),public.taxidta_web_session_validate(text,bigint,boolean),public.taxidta_web_session_rotate(text,bigint,text),public.taxidta_web_session_delete(text,bigint),public.taxidta_web_session_otp_consume(text,bigint),public.taxidta_web_session_otp_reset(text,bigint) TO authenticated;
COMMIT;
