-- ============================================================================
-- Migration 043: Lease E-Signature
--
-- Adds built-in e-signature workflow for lease agreements:
-- 1. lease_signatures table (signing request tracking + audit metadata)
-- 2. send_lease_for_signing() RPC (management → tenant)
-- 3. sign_lease() RPC (tenant signs, stores audit trail)
-- 4. void_lease_signature() RPC (management cancels)
-- 5. RLS policies
-- 6. Feature flag
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: lease_signatures table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lease_signatures (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id            uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'Pending'
                      CHECK (status IN ('Pending','Signed','Voided')),
  sent_by             uuid NOT NULL REFERENCES public.profiles(id),
  sent_at             timestamptz NOT NULL DEFAULT now(),
  signed_at           timestamptz,
  signed_by           uuid REFERENCES auth.users(id),
  signed_ip           inet,
  signed_user_agent   text,
  typed_signature     text,
  signed_pdf_path     text,
  voided_at           timestamptz,
  voided_reason       text
);

-- Only one pending or signed signature per lease at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_signature_per_lease
  ON public.lease_signatures(lease_id) WHERE status IN ('Pending', 'Signed');

CREATE INDEX IF NOT EXISTS idx_lease_signatures_lease_id
  ON public.lease_signatures(lease_id);

CREATE INDEX IF NOT EXISTS idx_lease_signatures_status
  ON public.lease_signatures(status);


-- ============================================================================
-- STEP 2: RLS policies
-- ============================================================================

ALTER TABLE public.lease_signatures ENABLE ROW LEVEL SECURITY;

-- Management: full CRUD
CREATE POLICY lease_signatures_management_all
  ON public.lease_signatures
  FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- Tenants: can read their own lease's signature record
CREATE POLICY lease_signatures_tenant_read
  ON public.lease_signatures
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = lease_signatures.lease_id
        AND l.user_id = (select auth.uid())
    )
  );

-- Finance readers: can read all signatures
CREATE POLICY lease_signatures_finance_read
  ON public.lease_signatures
  FOR SELECT
  TO authenticated
  USING (public.is_finance_reader());


-- ============================================================================
-- STEP 3: send_lease_for_signing() RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.send_lease_for_signing(
  p_lease_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_signature_id uuid;
  v_lease RECORD;
  v_tenant_email text;
  v_tenant_name text;
  v_property_name text;
BEGIN
  -- Validate caller is management
  IF NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied: management role required';
  END IF;

  -- Validate lease exists and is Active
  SELECT l.id, l.tenant_id, l.rent_amount, l.start_date, l.end_date,
         l.property_name, l.unit_number, l.user_id
  INTO v_lease
  FROM public.leases l
  WHERE l.id = p_lease_id AND l.status = 'Active';

  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION 'Lease not found or not active';
  END IF;

  -- Check no existing pending/signed signature
  IF EXISTS (
    SELECT 1 FROM public.lease_signatures
    WHERE lease_id = p_lease_id AND status IN ('Pending', 'Signed')
  ) THEN
    RAISE EXCEPTION 'This lease already has a pending or completed signature';
  END IF;

  -- Get tenant info for notification
  SELECT t.first_name || ' ' || t.last_name, t.email
  INTO v_tenant_name, v_tenant_email
  FROM public.tenants t
  WHERE t.id = v_lease.tenant_id;

  v_property_name := COALESCE(v_lease.property_name, 'Property');

  -- Insert signature request
  INSERT INTO public.lease_signatures (lease_id, sent_by)
  VALUES (p_lease_id, (select auth.uid()))
  RETURNING id INTO v_signature_id;

  -- Queue email notification to tenant
  IF v_tenant_email IS NOT NULL THEN
    INSERT INTO public.notification_queue (recipient_email, recipient_name, subject, body)
    VALUES (
      v_tenant_email,
      v_tenant_name,
      'Lease Agreement Ready for Signing - ' || v_property_name,
      'Dear ' || COALESCE(v_tenant_name, 'Tenant') || ',' || chr(10) || chr(10) ||
      'Your lease agreement for ' || v_property_name ||
      COALESCE(' Unit ' || v_lease.unit_number, '') ||
      ' is ready for your electronic signature.' || chr(10) || chr(10) ||
      'Lease Details:' || chr(10) ||
      '  Monthly Rent: $' || to_char(v_lease.rent_amount, 'FM999,999.00') || chr(10) ||
      '  Lease Start: ' || to_char(v_lease.start_date, 'Month DD, YYYY') || chr(10) ||
      '  Lease End: ' || COALESCE(to_char(v_lease.end_date, 'Month DD, YYYY'), 'Month-to-Month') || chr(10) || chr(10) ||
      'Please log in to your tenant portal to review and sign the lease agreement.' || chr(10) || chr(10) ||
      'Thank you,' || chr(10) ||
      'Property Management'
    );
  END IF;

  -- Log to system_activity
  INSERT INTO public.system_activity (event_type, title, description, actor_name)
  VALUES (
    'LEASE_ESIGN',
    'Lease Sent for Signing',
    'Lease for ' || COALESCE(v_tenant_name, 'Tenant') || ' at ' ||
    v_property_name || COALESCE(' Unit ' || v_lease.unit_number, '') ||
    ' sent for electronic signature.',
    (SELECT full_name FROM public.profiles WHERE id = (select auth.uid()))
  );

  RETURN v_signature_id;
END;
$$;


-- ============================================================================
-- STEP 4: sign_lease() RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.sign_lease(
  p_signature_id uuid,
  p_typed_signature text,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sig RECORD;
  v_lease RECORD;
  v_caller_id uuid;
  v_mgmt_email text;
  v_tenant_name text;
BEGIN
  v_caller_id := (select auth.uid());

  -- Validate signature is required
  IF p_typed_signature IS NULL OR trim(p_typed_signature) = '' THEN
    RAISE EXCEPTION 'Typed signature is required';
  END IF;

  -- Fetch the signature request
  SELECT s.* INTO v_sig
  FROM public.lease_signatures s
  WHERE s.id = p_signature_id AND s.status = 'Pending';

  IF v_sig.id IS NULL THEN
    RAISE EXCEPTION 'Signature request not found or not pending';
  END IF;

  -- Fetch the lease
  SELECT l.* INTO v_lease
  FROM public.leases l
  WHERE l.id = v_sig.lease_id AND l.status = 'Active';

  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION 'Associated lease not found or no longer active';
  END IF;

  -- Verify caller is the tenant on this lease
  IF v_lease.user_id != v_caller_id AND NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied: you are not authorized to sign this lease';
  END IF;

  -- Get tenant name
  SELECT t.first_name || ' ' || t.last_name INTO v_tenant_name
  FROM public.tenants t WHERE t.id = v_lease.tenant_id;

  -- Update signature record (PDF path will be set by the edge function after upload)
  UPDATE public.lease_signatures
  SET status = 'Signed',
      signed_at = now(),
      signed_by = v_caller_id,
      signed_ip = p_ip_address,
      signed_user_agent = p_user_agent,
      typed_signature = trim(p_typed_signature)
  WHERE id = p_signature_id;

  -- Queue notification to management
  SELECT u.email INTO v_mgmt_email
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id
  WHERE p.role IN ('Admin', 'Property Manager')
  LIMIT 1;

  IF v_mgmt_email IS NOT NULL THEN
    INSERT INTO public.notification_queue (recipient_email, recipient_name, subject, body)
    VALUES (
      v_mgmt_email,
      'Management',
      'Lease Signed - ' || COALESCE(v_lease.property_name, 'Property'),
      'A lease agreement has been electronically signed.' || chr(10) || chr(10) ||
      'Tenant: ' || COALESCE(v_tenant_name, 'N/A') || chr(10) ||
      'Property: ' || COALESCE(v_lease.property_name, 'N/A') ||
      COALESCE(' Unit ' || v_lease.unit_number, '') || chr(10) ||
      'Signed at: ' || to_char(now(), 'Month DD, YYYY HH12:MI AM') || chr(10) || chr(10) ||
      'The signed lease PDF has been stored in the documents system.'
    );
  END IF;

  -- Log to system_activity
  INSERT INTO public.system_activity (event_type, title, description, actor_name)
  VALUES (
    'LEASE_SIGNED',
    'Lease Electronically Signed',
    'Lease signed by ' || COALESCE(v_tenant_name, 'Tenant') || ' for ' ||
    COALESCE(v_lease.property_name, 'Property') ||
    COALESCE(' Unit ' || v_lease.unit_number, ''),
    COALESCE(v_tenant_name, 'Tenant')
  );
END;
$$;


-- ============================================================================
-- STEP 5: void_lease_signature() RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.void_lease_signature(
  p_signature_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Management only
  IF NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied: management role required';
  END IF;

  -- Validate exists and is pending
  IF NOT EXISTS (
    SELECT 1 FROM public.lease_signatures
    WHERE id = p_signature_id AND status = 'Pending'
  ) THEN
    RAISE EXCEPTION 'Signature request not found or not pending';
  END IF;

  UPDATE public.lease_signatures
  SET status = 'Voided',
      voided_at = now(),
      voided_reason = p_reason
  WHERE id = p_signature_id;
END;
$$;


-- ============================================================================
-- STEP 6: Feature flag
-- ============================================================================

INSERT INTO public.feature_flags (key, value, description)
VALUES ('lease_esign', true, 'Enable electronic lease signing workflow')
ON CONFLICT (key) DO NOTHING;


COMMIT;
