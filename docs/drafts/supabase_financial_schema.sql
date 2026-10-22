-- DESIGN SCAFFOLD ONLY. Not used by the local SQLite application.
-- Apply only to a new reviewed Frankfurt (AWS eu-central-1) Supabase project.
-- This does not configure region, disable signup, establish MFA, or grant health-data approval.
BEGIN;
CREATE SCHEMA IF NOT EXISTS taxidta;
REVOKE ALL ON SCHEMA taxidta FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA taxidta TO authenticated;

-- Seed the sole owner deliberately via the trusted SQL administration channel.
-- No browser policy may insert or replace this record. Never expose service_role.
CREATE TABLE taxidta.owner_account (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT
);
CREATE FUNCTION taxidta.is_owner_mfa() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT auth.uid() IS NOT NULL AND (auth.jwt()->>'aal') = 'aal2'
  AND EXISTS(SELECT 1 FROM taxidta.owner_account WHERE user_id = auth.uid()) $$;
REVOKE ALL ON FUNCTION taxidta.is_owner_mfa() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION taxidta.is_owner_mfa() TO authenticated;

CREATE TABLE taxidta.organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id),
 name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE taxidta.customers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES taxidta.organizations(id),
 kind text NOT NULL CHECK(kind IN ('private','business','laboratory','payer')),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 address text NOT NULL CHECK(length(address) BETWEEN 1 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id, organization_id)
);
CREATE TABLE taxidta.journeys (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 service_date date NOT NULL,
 snapshot jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(customer_id,organization_id) REFERENCES taxidta.customers(id,organization_id),
 UNIQUE(id, organization_id)
);
CREATE TABLE taxidta.invoices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 customer_id uuid NOT NULL,
 number text NOT NULL,
 kind text NOT NULL CHECK(kind IN('invoice','credit')),
 original_invoice_id uuid,
 issued_on date NOT NULL,
 due_on date NOT NULL CHECK(due_on >= issued_on),
 gross_cents bigint NOT NULL,
 net_cents bigint NOT NULL,
 tax_cents bigint NOT NULL,
 snapshot jsonb NOT NULL,
 pdf_sha256 text NOT NULL CHECK(pdf_sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(gross_cents = net_cents + tax_cents),
 CHECK((kind='invoice' AND gross_cents > 0 AND original_invoice_id IS NULL) OR (kind='credit' AND gross_cents < 0 AND original_invoice_id IS NOT NULL)),
 FOREIGN KEY(customer_id,organization_id) REFERENCES taxidta.customers(id,organization_id),
 UNIQUE(id,organization_id),
 UNIQUE(organization_id,number),
 FOREIGN KEY(original_invoice_id,organization_id) REFERENCES taxidta.invoices(id,organization_id)
);
CREATE UNIQUE INDEX one_full_credit_per_invoice ON taxidta.invoices(original_invoice_id) WHERE kind='credit';
CREATE TABLE taxidta.invoice_journeys (
 organization_id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 journey_id uuid NOT NULL,
 PRIMARY KEY(invoice_id,journey_id),
 UNIQUE(journey_id),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES taxidta.invoices(id,organization_id),
 FOREIGN KEY(journey_id,organization_id) REFERENCES taxidta.journeys(id,organization_id)
);
CREATE TABLE taxidta.payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 amount_cents bigint NOT NULL CHECK(amount_cents > 0),
 paid_on date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES taxidta.invoices(id,organization_id)
);
CREATE TABLE taxidta.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES taxidta.organizations(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL,
 entity_id uuid,
 previous_hash text NOT NULL,
 event_hash text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE taxidta.documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES taxidta.organizations(id),
 object_key text NOT NULL UNIQUE,
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE taxidta.dta_readiness_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 invoice_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'blocked' CHECK(status='blocked'),
 report jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(invoice_id,organization_id) REFERENCES taxidta.invoices(id,organization_id)
);

CREATE FUNCTION taxidta.prevent_financial_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$ BEGIN
 RAISE EXCEPTION 'Financial records are append-only. Use a linked credit/correction.';
END $$;
CREATE TRIGGER invoices_append_only BEFORE UPDATE OR DELETE ON taxidta.invoices
FOR EACH ROW EXECUTE FUNCTION taxidta.prevent_financial_mutation();
CREATE TRIGGER payments_append_only BEFORE UPDATE OR DELETE ON taxidta.payments
FOR EACH ROW EXECUTE FUNCTION taxidta.prevent_financial_mutation();
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON taxidta.audit_events
FOR EACH ROW EXECUTE FUNCTION taxidta.prevent_financial_mutation();
CREATE TRIGGER invoice_journeys_append_only BEFORE UPDATE OR DELETE ON taxidta.invoice_journeys
FOR EACH ROW EXECUTE FUNCTION taxidta.prevent_financial_mutation();

ALTER TABLE taxidta.owner_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE taxidta.owner_account FORCE ROW LEVEL SECURITY;
-- owner_account has no client policy: deny all. Function above reads as trusted DB owner.
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['organizations','customers','journeys','invoices','invoice_journeys','payments','audit_events','documents','dta_readiness_reports'] LOOP
  EXECUTE format('ALTER TABLE taxidta.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE taxidta.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON taxidta.%I FROM PUBLIC, anon, authenticated',table_name);
  EXECUTE format('GRANT SELECT ON taxidta.%I TO authenticated',table_name);
  IF table_name = 'organizations' THEN
   EXECUTE format('CREATE POLICY owner_read ON taxidta.%I FOR SELECT TO authenticated USING (taxidta.is_owner_mfa() AND owner_id = auth.uid())',table_name);
  ELSE
   EXECUTE format('CREATE POLICY owner_read ON taxidta.%I FOR SELECT TO authenticated USING (taxidta.is_owner_mfa() AND organization_id IN (SELECT id FROM taxidta.organizations WHERE owner_id = auth.uid()))',table_name);
  END IF;
 END LOOP;
END $$;
-- Deliberately NO browser INSERT/UPDATE/DELETE privileges or policies.
-- A future trusted server transaction must verify identity, MFA, ownership, totals,
-- numbering, payment limits and immutable PDF creation before writing.
INSERT INTO storage.buckets(id,name,public) VALUES('taxidta-private-documents','taxidta-private-documents',false)
ON CONFLICT(id) DO UPDATE SET public=false;
-- No storage.objects policies granted. Review project-wide pre-existing policies.
COMMIT;
