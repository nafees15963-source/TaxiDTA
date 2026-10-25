-- Private single-owner workspace, created with Supabase CLI migration new.
-- Apply edge_web_session_metadata first. No privileged API key is required.
BEGIN;
CREATE TABLE taxidta.workspace_state (
 owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
 revision bigint NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 payload jsonb NOT NULL CHECK(pg_catalog.octet_length(payload::text)<=1900000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE taxidta.workspace_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxidta.workspace_state NO FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE taxidta.workspace_state FROM PUBLIC,anon,authenticated;
CREATE POLICY workspace_state_deny_clients ON taxidta.workspace_state AS RESTRICTIVE
 FOR ALL TO authenticated USING(false) WITH CHECK(false);

-- Ordered prefixes preserve original bytes/fields, not merely the set of IDs.
CREATE FUNCTION taxidta.workspace_array_prefix(p_old jsonb,p_new jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $$ BEGIN
 IF pg_catalog.jsonb_typeof(p_old) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(p_new) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 RETURN pg_catalog.jsonb_array_length(p_new)>=pg_catalog.jsonb_array_length(p_old)
 AND NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_old) WITH ORDINALITY AS e(value,ord)
 WHERE e.value IS DISTINCT FROM p_new->((e.ord-1)::integer));
END $$;

CREATE FUNCTION taxidta.workspace_validate_payload(p_payload jsonb,p_owner uuid) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $$ DECLARE
 field text; row_value jsonb; related jsonb; line_value jsonb; payment jsonb;
 expected_keys text[]:=ARRAY['schema','scopeHash','businessDate','customers','journeys','invoices','billingCases','dtaChecks','audit','pdfs','casePayers','caseCommands','invoiceCommands','paymentCommands','cancellations','counters'];
 array_keys text[]:=ARRAY['customers','journeys','invoices','billingCases','dtaChecks','audit','pdfs','casePayers','caseCommands','invoiceCommands','paymentCommands','cancellations','counters'];
 actual_keys text[]; amount numeric; total numeric; calendar_date date;
BEGIN
 IF pg_catalog.jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR pg_catalog.octet_length(p_payload::text)>1900000 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid workspace envelope or size'; END IF;
 SELECT pg_catalog.array_agg(k) INTO actual_keys FROM pg_catalog.jsonb_object_keys(p_payload) AS k;
 IF actual_keys IS NULL OR NOT(actual_keys @> expected_keys AND actual_keys <@ expected_keys)
 OR p_payload->'schema' IS DISTINCT FROM '1'::jsonb
 OR p_payload->>'scopeHash' IS DISTINCT FROM pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_owner::text,'UTF8')),'hex')
 OR coalesce(p_payload->>'businessDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Workspace identity or schema mismatch'; END IF;
 BEGIN calendar_date:=(p_payload->>'businessDate')::date;
 EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid workspace business date'; END;
 IF pg_catalog.to_char(calendar_date,'YYYY-MM-DD')<>p_payload->>'businessDate' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid workspace business date'; END IF;
 FOREACH field IN ARRAY array_keys LOOP
  IF pg_catalog.jsonb_typeof(p_payload->field) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Workspace collection is not an array'; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['customers','journeys','invoices','billingCases','dtaChecks'] LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->field) AS x(v)
   WHERE pg_catalog.jsonb_typeof(x.v) IS DISTINCT FROM 'object' OR coalesce(x.v->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_payload->field))<>(SELECT count(DISTINCT x.v->>'id') FROM pg_catalog.jsonb_array_elements(p_payload->field) AS x(v))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Workspace collection identifiers invalid or duplicated'; END IF;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['caseCommands','invoiceCommands','paymentCommands'] LOOP
  IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->field) AS x(v) WHERE pg_catalog.jsonb_typeof(x.v) IS DISTINCT FROM 'object'
   OR coalesce(x.v->>'key','') !~ '^[A-Za-z0-9_-]{8,100}$' OR coalesce(x.v->>'requestHash','') !~ '^[a-f0-9]{64}$'
   OR coalesce(x.v->>'entityId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_payload->field))<>(SELECT count(DISTINCT x.v->>'key') FROM pg_catalog.jsonb_array_elements(p_payload->field) AS x(v))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Workspace command identifiers invalid or duplicated'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'counters') AS x(v) WHERE pg_catalog.jsonb_typeof(x.v) IS DISTINCT FROM 'object'
  OR coalesce(x.v->>'year','') !~ '^[0-9]{4}$' OR coalesce(x.v->>'value','') !~ '^[0-9]{1,15}$')
 OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_payload->'counters'))<>(SELECT count(DISTINCT x.v->>'year') FROM pg_catalog.jsonb_array_elements(p_payload->'counters') AS x(v))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Workspace counters invalid or duplicated'; END IF;

 -- Every original and credit has one byte/hash-verified archive. No orphan PDFs.
 IF pg_catalog.jsonb_array_length(p_payload->'pdfs')<>pg_catalog.jsonb_array_length(p_payload->'invoices')
 OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_payload->'pdfs'))<>(SELECT count(DISTINCT x.v->>'invoiceId') FROM pg_catalog.jsonb_array_elements(p_payload->'pdfs') AS x(v))
 OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_payload->'invoices'))<>(SELECT count(DISTINCT x.v->>'number') FROM pg_catalog.jsonb_array_elements(p_payload->'invoices') AS x(v))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice archive or number uniqueness violated'; END IF;
 FOR row_value IN SELECT v FROM pg_catalog.jsonb_array_elements(p_payload->'pdfs') AS x(v) LOOP
  SELECT v INTO related FROM pg_catalog.jsonb_array_elements(p_payload->'invoices') AS x(v) WHERE v->>'id'=row_value->>'invoiceId';
  IF related IS NULL OR coalesce(row_value->>'sha256','') !~ '^[a-f0-9]{64}$' OR row_value->>'sha256' IS DISTINCT FROM related->>'pdfHash'
  OR pg_catalog.jsonb_typeof(row_value->'base64') IS DISTINCT FROM 'string' OR coalesce(row_value->>'base64','') !~ '^[A-Za-z0-9+/]+={0,2}$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid invoice archive'; END IF;
  BEGIN
   IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.decode(row_value->>'base64','base64')),'hex') IS DISTINCT FROM row_value->>'sha256' THEN RAISE EXCEPTION 'hash mismatch'; END IF;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice archive hash mismatch'; END;
 END LOOP;
 FOR row_value IN SELECT v FROM pg_catalog.jsonb_array_elements(p_payload->'invoices') AS x(v) LOOP
  IF pg_catalog.jsonb_typeof(row_value->'payments') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(row_value->'lines') IS DISTINCT FROM 'array'
  OR row_value->>'status' IS DISTINCT FROM 'issued' OR row_value->'cancelledBy' IS DISTINCT FROM 'null'::jsonb
  OR coalesce(row_value->>'grossCents','') !~ '^-?[0-9]{1,15}$' OR coalesce(row_value->>'netCents','') !~ '^-?[0-9]{1,15}$' OR coalesce(row_value->>'taxCents','') !~ '^-?[0-9]{1,15}$'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid immutable invoice record'; END IF;
  IF (row_value->>'grossCents')::numeric<>(row_value->>'netCents')::numeric+(row_value->>'taxCents')::numeric
  OR pg_catalog.jsonb_array_length(row_value->'lines')=0 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice totals invalid'; END IF;
  total:=0;
  FOR payment IN SELECT v FROM pg_catalog.jsonb_array_elements(row_value->'payments') AS x(v) LOOP
   IF coalesce(payment->>'amountCents','') !~ '^[0-9]{1,9}$' OR coalesce(payment->>'id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
   THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid append-only payment'; END IF;
   amount:=(payment->>'amountCents')::numeric;
   IF amount<1 OR amount>100000000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid payment amount'; END IF;
   total:=total+amount;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(row_value->'payments'))<>(SELECT count(DISTINCT x.v->>'id') FROM pg_catalog.jsonb_array_elements(row_value->'payments') AS x(v))
  OR (total>0 AND (row_value->>'originalInvoiceId' IS NOT NULL OR total>(row_value->>'grossCents')::numeric
   OR EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'cancellations') AS x(v) WHERE x.v->>'invoiceId'=row_value->>'id')))
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Payments exceed or contradict invoice'; END IF;
  FOR line_value IN SELECT v FROM pg_catalog.jsonb_array_elements(row_value->'lines') AS x(v) LOOP
   IF coalesce(line_value->>'grossCents','') !~ '^-?[0-9]{1,15}$' OR coalesce(line_value->>'netCents','') !~ '^-?[0-9]{1,15}$' OR coalesce(line_value->>'taxCents','') !~ '^-?[0-9]{1,15}$'
   OR line_value->>'taxRate' NOT IN ('7','19') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid immutable invoice line'; END IF;
   IF (line_value->>'grossCents')::numeric<>(line_value->>'netCents')::numeric+(line_value->>'taxCents')::numeric THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice line totals invalid'; END IF;
   SELECT v INTO related FROM pg_catalog.jsonb_array_elements(p_payload->'journeys') AS x(v) WHERE v->>'id'=line_value->>'journeyId';
   IF related IS NULL OR related->>'invoiceId' IS DISTINCT FROM coalesce(row_value->>'originalInvoiceId',row_value->>'id') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice journey binding invalid'; END IF;
  END LOOP;
  IF (SELECT sum((v->>'grossCents')::numeric) FROM pg_catalog.jsonb_array_elements(row_value->'lines') AS x(v))<>(row_value->>'grossCents')::numeric
  OR (SELECT sum((v->>'netCents')::numeric) FROM pg_catalog.jsonb_array_elements(row_value->'lines') AS x(v))<>(row_value->>'netCents')::numeric
  OR (SELECT sum((v->>'taxCents')::numeric) FROM pg_catalog.jsonb_array_elements(row_value->'lines') AS x(v))<>(row_value->>'taxCents')::numeric
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice line sums invalid'; END IF;
 END LOOP;
 -- Cancellation remains an append-only overlay linked to a separate negative credit.
 IF (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_payload->'cancellations'))<>(SELECT count(DISTINCT v->>'invoiceId') FROM pg_catalog.jsonb_array_elements(p_payload->'cancellations') AS x(v))
 OR (SELECT count(*) FROM pg_catalog.jsonb_array_elements(p_payload->'cancellations'))<>(SELECT count(DISTINCT v->>'creditId') FROM pg_catalog.jsonb_array_elements(p_payload->'cancellations') AS x(v))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Duplicate cancellation'; END IF;
 FOR row_value IN SELECT v FROM pg_catalog.jsonb_array_elements(p_payload->'cancellations') AS x(v) LOOP
  SELECT v INTO related FROM pg_catalog.jsonb_array_elements(p_payload->'invoices') AS x(v) WHERE v->>'id'=row_value->>'invoiceId';
  IF related IS NULL OR related->>'originalInvoiceId' IS NOT NULL OR pg_catalog.jsonb_array_length(related->'payments')<>0
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'invoices') AS x(v)
   WHERE v->>'id'=row_value->>'creditId' AND v->>'originalInvoiceId'=related->>'id'
   AND (v->>'grossCents')::numeric=-(related->>'grossCents')::numeric AND (v->>'netCents')::numeric=-(related->>'netCents')::numeric AND (v->>'taxCents')::numeric=-(related->>'taxCents')::numeric)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Cancellation original or credit invalid'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'invoices') AS x(v) WHERE v->>'originalInvoiceId' IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'cancellations') AS c(v) WHERE c.v->>'creditId'=x.v->>'id' AND c.v->>'invoiceId'=x.v->>'originalInvoiceId'))
 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Credit requires cancellation overlay'; END IF;
 FOR row_value IN SELECT v FROM pg_catalog.jsonb_array_elements(p_payload->'billingCases') AS x(v) LOOP
  IF pg_catalog.jsonb_typeof(row_value->'journeys') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(row_value->'journeyIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid case journeys'; END IF;
  IF pg_catalog.jsonb_array_length(row_value->'journeys') NOT BETWEEN 1 AND 20 OR pg_catalog.jsonb_array_length(row_value->'journeys')<>pg_catalog.jsonb_array_length(row_value->'journeyIds') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Case requires one to twenty journeys'; END IF;
  IF row_value->>'invoiceId' IS NOT NULL AND (row_value->>'status' IS DISTINCT FROM 'invoiced'
   OR NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'invoices') AS x(v) WHERE v->>'id'=row_value->>'invoiceId' AND v->>'originalInvoiceId' IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Case invoice binding invalid'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(p_payload->'dtaChecks') AS x(v) WHERE v->>'mode' IS DISTINCT FROM 'dry-run' OR v->>'status' IS DISTINCT FROM 'blocked' OR v->>'format' IS DISTINCT FROM 'readiness-report') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Readiness report cannot assert transport acceptance'; END IF;
END $$;

CREATE FUNCTION taxidta.workspace_validate_transition(p_old jsonb,p_new jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path=''
AS $$ DECLARE field text; old_row jsonb; new_row jsonb; BEGIN
 FOREACH field IN ARRAY ARRAY['pdfs','audit','dtaChecks','casePayers','caseCommands','invoiceCommands','paymentCommands','cancellations'] LOOP
  IF taxidta.workspace_array_prefix(p_old->field,p_new->field) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Append-only workspace history changed'; END IF;
 END LOOP;
 IF pg_catalog.jsonb_array_length(p_new->'invoices')<pg_catalog.jsonb_array_length(p_old->'invoices') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice original removed'; END IF;
 FOR old_row IN SELECT v FROM pg_catalog.jsonb_array_elements(p_old->'invoices') AS x(v) LOOP
  SELECT v INTO new_row FROM pg_catalog.jsonb_array_elements(p_new->'invoices') AS x(v) WHERE v->>'id'=old_row->>'id';
  IF new_row IS NULL OR (old_row-'payments') IS DISTINCT FROM (new_row-'payments') OR taxidta.workspace_array_prefix(old_row->'payments',new_row->'payments') IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice original or recorded payment changed'; END IF;
 END LOOP;
 -- Draft journeys may be replaced while correcting their shared prescription.
 FOREACH field IN ARRAY ARRAY['journeys','billingCases'] LOOP
  FOR old_row IN SELECT v FROM pg_catalog.jsonb_array_elements(p_old->field) AS x(v) WHERE v->>'invoiceId' IS NOT NULL LOOP
   SELECT v INTO new_row FROM pg_catalog.jsonb_array_elements(p_new->field) AS x(v) WHERE v->>'id'=old_row->>'id';
   IF old_row IS DISTINCT FROM new_row THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Already invoiced journey or case changed'; END IF;
  END LOOP;
 END LOOP;
 FOR old_row IN SELECT v FROM pg_catalog.jsonb_array_elements(p_old->'counters') AS x(v) LOOP
  SELECT v INTO new_row FROM pg_catalog.jsonb_array_elements(p_new->'counters') AS x(v) WHERE v->>'year'=old_row->>'year';
  IF new_row IS NULL OR (new_row->>'value')::numeric<(old_row->>'value')::numeric THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invoice counter decreased or removed'; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION taxidta.workspace_array_prefix(jsonb,jsonb),taxidta.workspace_validate_payload(jsonb,uuid),taxidta.workspace_validate_transition(jsonb,jsonb) FROM PUBLIC,anon,authenticated;

-- Sole privileged entry point; the transaction holds the live web-session row lock.
CREATE FUNCTION taxidta.workspace_operation(p_operation text,p_expected_revision bigint,p_payload jsonb,p_nonce_hash text,p_generation bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=''
AS $$ DECLARE current_row taxidta.workspace_state; owner_uuid uuid; inserted_revision bigint; BEGIN
 IF taxidta.is_owner_mfa() IS NOT TRUE OR taxidta.web_session_is_active(p_nonce_hash,p_generation) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Verified owner MFA and active app session required'; END IF;
 owner_uuid:=auth.uid();
 IF owner_uuid IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Verified owner required'; END IF;
 IF p_operation='read' THEN
  SELECT s.* INTO current_row FROM taxidta.workspace_state s WHERE s.owner_id=owner_uuid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pg_catalog.jsonb_build_object('revision',current_row.revision,'payload',current_row.payload);
 END IF;
 IF p_operation<>'compare_and_swap' OR p_expected_revision<1 OR p_expected_revision>=9007199254740991 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Invalid workspace operation or revision'; END IF;
 PERFORM taxidta.workspace_validate_payload(p_payload,owner_uuid);
 IF p_expected_revision IS NULL THEN
  INSERT INTO taxidta.workspace_state(owner_id,revision,payload) VALUES(owner_uuid,1,p_payload)
  ON CONFLICT(owner_id) DO NOTHING RETURNING revision INTO inserted_revision;
  IF inserted_revision IS NULL THEN RETURN pg_catalog.jsonb_build_object('applied',false); END IF;
  RETURN pg_catalog.jsonb_build_object('applied',true,'revision',inserted_revision);
 END IF;
 SELECT s.* INTO current_row FROM taxidta.workspace_state s WHERE s.owner_id=owner_uuid FOR UPDATE;
 IF NOT FOUND OR current_row.revision<>p_expected_revision THEN RETURN pg_catalog.jsonb_build_object('applied',false); END IF;
 PERFORM taxidta.workspace_validate_transition(current_row.payload,p_payload);
 UPDATE taxidta.workspace_state s SET payload=p_payload,revision=s.revision+1,updated_at=now() WHERE s.owner_id=owner_uuid RETURNING s.revision INTO inserted_revision;
 RETURN pg_catalog.jsonb_build_object('applied',true,'revision',inserted_revision);
END $$;
REVOKE ALL ON FUNCTION taxidta.workspace_operation(text,bigint,jsonb,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION taxidta.workspace_operation(text,bigint,jsonb,text,bigint) TO authenticated;

CREATE FUNCTION public.taxidta_workspace_read(p_nonce_hash text,p_generation bigint) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=''
AS $$ SELECT taxidta.workspace_operation('read',NULL,NULL,p_nonce_hash,p_generation) $$;
CREATE FUNCTION public.taxidta_workspace_compare_and_swap(p_expected_revision bigint,p_payload jsonb,p_nonce_hash text,p_generation bigint) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path=''
AS $$ SELECT taxidta.workspace_operation('compare_and_swap',p_expected_revision,p_payload,p_nonce_hash,p_generation) $$;
REVOKE ALL ON FUNCTION public.taxidta_workspace_read(text,bigint),public.taxidta_workspace_compare_and_swap(bigint,jsonb,text,bigint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.taxidta_workspace_read(text,bigint),public.taxidta_workspace_compare_and_swap(bigint,jsonb,text,bigint) TO authenticated;
COMMIT;
