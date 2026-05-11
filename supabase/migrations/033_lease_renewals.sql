-- ============================================================================
-- Migration 033: Lease Renewals & E-Sign
--
-- Adds renewal offer workflow on top of existing lease_renewal_scores:
-- 1. lease_renewals table (offer tracking + digital acceptance metadata)
-- 2. create_renewal_offer() RPC
-- 3. accept_renewal_offer() RPC (atomic: expire old → create new lease)
-- 4. decline_renewal_offer() RPC
-- 5. withdraw_renewal_offer() RPC
-- 6. RLS policies
-- 7. Indexes
-- 8. Feature flag
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: lease_renewals table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.lease_renewals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id            uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  proposed_rent       numeric NOT NULL,
  proposed_end_date   date NOT NULL,
  notes               text,
  status              text NOT NULL DEFAULT 'Pending'
                      CHECK (status IN ('Pending','Accepted','Declined','Withdrawn')),
  created_by          uuid NOT NULL REFERENCES public.profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  accepted_at         timestamptz,
  accepted_by         uuid REFERENCES auth.users(id),
  accepted_ip         inet,
  accepted_user_agent text,
  resolved_at         timestamptz,
  resolved_reason     text,
  offer_pdf_path      text,
  executed_pdf_path   text,
  new_lease_id        uuid REFERENCES public.leases(id)
);

-- Only one pending offer per lease at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_pending_renewal_per_lease
  ON public.lease_renewals(lease_id) WHERE status = 'Pending';

CREATE INDEX IF NOT EXISTS idx_lease_renewals_lease_id
  ON public.lease_renewals(lease_id);

CREATE INDEX IF NOT EXISTS idx_lease_renewals_status
  ON public.lease_renewals(status);


-- ============================================================================
-- STEP 2: RLS policies on lease_renewals
-- ============================================================================

ALTER TABLE public.lease_renewals ENABLE ROW LEVEL SECURITY;

-- Management: full CRUD
CREATE POLICY lease_renewals_management_all
  ON public.lease_renewals
  FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- Tenants: can read their own renewal offers (via lease → user_id)
CREATE POLICY lease_renewals_tenant_read
  ON public.lease_renewals
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = lease_renewals.lease_id
        AND l.user_id = (select auth.uid())
    )
  );

-- Finance readers: can read all renewals
CREATE POLICY lease_renewals_finance_read
  ON public.lease_renewals
  FOR SELECT
  TO authenticated
  USING (public.is_finance_reader());


-- ============================================================================
-- STEP 3: create_renewal_offer() RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_renewal_offer(
  p_lease_id uuid,
  p_proposed_rent numeric,
  p_proposed_end_date date,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_renewal_id uuid;
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
  SELECT l.id, l.tenant_id, l.end_date, l.rent_amount, l.user_id,
         l.property_name, l.unit_number
  INTO v_lease
  FROM public.leases l
  WHERE l.id = p_lease_id AND l.status = 'Active';

  IF v_lease.id IS NULL THEN
    RAISE EXCEPTION 'Lease not found or not active';
  END IF;

  -- Validate proposed end date is after current end date
  IF p_proposed_end_date <= v_lease.end_date THEN
    RAISE EXCEPTION 'Proposed end date must be after current lease end date';
  END IF;

  -- Get tenant info for notification
  SELECT t.first_name || ' ' || t.last_name, t.email
  INTO v_tenant_name, v_tenant_email
  FROM public.tenants t
  WHERE t.id = v_lease.tenant_id;

  v_property_name := COALESCE(v_lease.property_name, 'Property');

  -- Insert renewal offer
  INSERT INTO public.lease_renewals (
    lease_id, proposed_rent, proposed_end_date, notes, created_by
  )
  VALUES (
    p_lease_id, p_proposed_rent, p_proposed_end_date, p_notes, (select auth.uid())
  )
  RETURNING id INTO v_renewal_id;

  -- Queue email notification to tenant
  IF v_tenant_email IS NOT NULL THEN
    INSERT INTO public.notification_queue (recipient_email, recipient_name, subject, body)
    VALUES (
      v_tenant_email,
      v_tenant_name,
      'Lease Renewal Offer - ' || v_property_name,
      'Dear ' || COALESCE(v_tenant_name, 'Tenant') || ',' || chr(10) || chr(10) ||
      'A lease renewal offer has been prepared for your unit at ' || v_property_name ||
      COALESCE(' Unit ' || v_lease.unit_number, '') || '.' || chr(10) || chr(10) ||
      'Proposed new rent: $' || to_char(p_proposed_rent, 'FM999,999.00') || chr(10) ||
      'New lease end date: ' || to_char(p_proposed_end_date, 'Month DD, YYYY') || chr(10) || chr(10) ||
      'Please log in to your tenant portal to review and accept or decline this offer.' || chr(10) || chr(10) ||
      'Thank you,' || chr(10) ||
      'Property Management'
    );
  END IF;

  RETURN v_renewal_id;
END;
$$;


-- ============================================================================
-- STEP 4: accept_renewal_offer() RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_renewal_offer(
  p_renewal_id uuid,
  p_ip_address inet DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_renewal RECORD;
  v_old_lease RECORD;
  v_new_lease_id uuid;
  v_caller_id uuid;
  v_mgmt_email text;
BEGIN
  v_caller_id := (select auth.uid());

  -- Fetch the renewal offer
  SELECT r.* INTO v_renewal
  FROM public.lease_renewals r
  WHERE r.id = p_renewal_id AND r.status = 'Pending';

  IF v_renewal.id IS NULL THEN
    RAISE EXCEPTION 'Renewal offer not found or not pending';
  END IF;

  -- Fetch the existing lease
  SELECT l.* INTO v_old_lease
  FROM public.leases l
  WHERE l.id = v_renewal.lease_id AND l.status = 'Active';

  IF v_old_lease.id IS NULL THEN
    RAISE EXCEPTION 'Associated lease not found or no longer active';
  END IF;

  -- Verify caller is the tenant on this lease OR is management
  IF v_old_lease.user_id != v_caller_id AND NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied: you are not authorized to accept this offer';
  END IF;

  -- STEP A: Expire the old lease FIRST (before creating new one to satisfy unique constraint)
  UPDATE public.leases
  SET status = 'Expired'
  WHERE id = v_old_lease.id;

  -- STEP B: Create the new lease
  INSERT INTO public.leases (
    tenant_id, unit_id, user_id, rent_amount, security_deposit,
    start_date, end_date, status, email, property_name, unit_number,
    utility_fee
  )
  VALUES (
    v_old_lease.tenant_id,
    v_old_lease.unit_id,
    v_old_lease.user_id,
    v_renewal.proposed_rent,
    v_old_lease.security_deposit,
    v_old_lease.end_date + 1,           -- new lease starts day after old ends
    v_renewal.proposed_end_date,
    'Active',
    v_old_lease.email,
    v_old_lease.property_name,
    v_old_lease.unit_number,
    v_old_lease.utility_fee
  )
  RETURNING id INTO v_new_lease_id;

  -- STEP C: Update the renewal record with acceptance metadata
  UPDATE public.lease_renewals
  SET status = 'Accepted',
      accepted_at = now(),
      accepted_by = v_caller_id,
      accepted_ip = p_ip_address,
      accepted_user_agent = p_user_agent,
      resolved_at = now(),
      new_lease_id = v_new_lease_id
  WHERE id = p_renewal_id;

  -- STEP D: Queue notification to management
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
      'Lease Renewal Accepted - ' || COALESCE(v_old_lease.property_name, 'Property'),
      'A lease renewal offer has been accepted.' || chr(10) || chr(10) ||
      'Property: ' || COALESCE(v_old_lease.property_name, 'N/A') ||
      COALESCE(' Unit ' || v_old_lease.unit_number, '') || chr(10) ||
      'New Rent: $' || to_char(v_renewal.proposed_rent, 'FM999,999.00') || chr(10) ||
      'New End Date: ' || to_char(v_renewal.proposed_end_date, 'Month DD, YYYY') || chr(10) || chr(10) ||
      'The new lease has been created automatically.'
    );
  END IF;

  -- Log to system_activity
  INSERT INTO public.system_activity (event_type, title, description, actor_name)
  VALUES (
    'LEASE_RENEWAL',
    'Lease Renewal Accepted',
    'Renewal accepted for ' || COALESCE(v_old_lease.property_name, 'Property') ||
    COALESCE(' Unit ' || v_old_lease.unit_number, '') ||
    '. New rent: $' || to_char(v_renewal.proposed_rent, 'FM999,999.00'),
    'Renewal Engine'
  );

  RETURN v_new_lease_id;
END;
$$;


-- ============================================================================
-- STEP 5: decline_renewal_offer() RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.decline_renewal_offer(
  p_renewal_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_renewal RECORD;
  v_caller_id uuid;
BEGIN
  v_caller_id := (select auth.uid());

  SELECT r.*, l.user_id AS lease_user_id
  INTO v_renewal
  FROM public.lease_renewals r
  JOIN public.leases l ON l.id = r.lease_id
  WHERE r.id = p_renewal_id AND r.status = 'Pending';

  IF v_renewal.id IS NULL THEN
    RAISE EXCEPTION 'Renewal offer not found or not pending';
  END IF;

  -- Must be tenant on the lease or management
  IF v_renewal.lease_user_id != v_caller_id AND NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  UPDATE public.lease_renewals
  SET status = 'Declined',
      resolved_at = now(),
      resolved_reason = p_reason
  WHERE id = p_renewal_id;
END;
$$;


-- ============================================================================
-- STEP 6: withdraw_renewal_offer() RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.withdraw_renewal_offer(
  p_renewal_id uuid,
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

  -- Validate the offer exists and is pending
  IF NOT EXISTS (
    SELECT 1 FROM public.lease_renewals
    WHERE id = p_renewal_id AND status = 'Pending'
  ) THEN
    RAISE EXCEPTION 'Renewal offer not found or not pending';
  END IF;

  UPDATE public.lease_renewals
  SET status = 'Withdrawn',
      resolved_at = now(),
      resolved_reason = p_reason
  WHERE id = p_renewal_id;
END;
$$;


-- ============================================================================
-- STEP 7: Feature flag
-- ============================================================================

INSERT INTO public.feature_flags (key, value, description)
VALUES ('lease_renewals', true, 'Enable lease renewal offers and e-sign workflow')
ON CONFLICT (key) DO NOTHING;


COMMIT;
