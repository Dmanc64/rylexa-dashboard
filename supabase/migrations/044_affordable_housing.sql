-- ============================================================================
-- Migration 044: Affordable Housing Compliance MVP
--
-- Adds affordable housing compliance tracking:
-- 1. ALTER existing tables (properties, units, leases)
-- 2. New tables: income_certifications, household_members, ami_limits,
--    rent_limits, compliance_alerts
-- 3. RPC functions for certification and compliance checks
-- 4. RLS policies
-- 5. Compliance dashboard view
-- 6. Feature flag
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1A: Extend existing tables
-- ============================================================================

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS is_affordable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS program_types text[] DEFAULT '{}';

COMMENT ON COLUMN public.properties.is_affordable IS 'Whether this property participates in any affordable housing program.';
COMMENT ON COLUMN public.properties.program_types IS 'Array of program types: LIHTC, Section 8, HOME, USDA/RD, State/Local, Other';

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS bedroom_count integer,
  ADD COLUMN IF NOT EXISTS ami_percentage integer,
  ADD COLUMN IF NOT EXISTS max_gross_rent numeric(10,2),
  ADD COLUMN IF NOT EXISTS utility_allowance numeric(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_restricted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.units.ami_percentage IS 'AMI level this unit is restricted to (30, 50, 60, 80). NULL = market rate.';
COMMENT ON COLUMN public.units.max_gross_rent IS 'Maximum gross rent allowed based on AMI% and bedroom count.';
COMMENT ON COLUMN public.units.utility_allowance IS 'Monthly utility allowance for this unit.';
COMMENT ON COLUMN public.units.is_restricted IS 'Whether this unit has an income/rent restriction.';

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS tenant_portion numeric(10,2),
  ADD COLUMN IF NOT EXISTS subsidy_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS subsidy_source text;

COMMENT ON COLUMN public.leases.tenant_portion IS 'The amount the tenant pays toward rent (total rent - subsidy).';
COMMENT ON COLUMN public.leases.subsidy_amount IS 'Housing assistance payment amount (HAP, subsidy, voucher).';
COMMENT ON COLUMN public.leases.subsidy_source IS 'Source of subsidy: Section 8 Voucher, Project-Based, HOME, etc.';


-- ============================================================================
-- STEP 1B: income_certifications table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.income_certifications (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lease_id                uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  certification_date      date NOT NULL,
  effective_date          date NOT NULL,
  next_recertification_date date NOT NULL,
  annual_income           numeric(12,2) NOT NULL,
  household_size          integer NOT NULL DEFAULT 1,
  ami_percentage_at_cert  integer NOT NULL,
  certification_type      text NOT NULL DEFAULT 'Initial'
                          CHECK (certification_type IN ('Initial', 'Annual', 'Interim')),
  status                  text NOT NULL DEFAULT 'Pending'
                          CHECK (status IN ('Pending', 'Active', 'Expired', 'Superseded')),
  certified_by            uuid REFERENCES public.profiles(id),
  notes                   text,
  student_status          text DEFAULT 'None'
                          CHECK (student_status IN ('None', 'Partial', 'All-Exempt', 'All-Ineligible')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_income_certs_tenant ON public.income_certifications(tenant_id);
CREATE INDEX idx_income_certs_lease ON public.income_certifications(lease_id);
CREATE INDEX idx_income_certs_status ON public.income_certifications(status);
CREATE INDEX idx_income_certs_next_recert ON public.income_certifications(next_recertification_date)
  WHERE status = 'Active';


-- ============================================================================
-- STEP 1C: household_members table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.household_members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id   uuid NOT NULL REFERENCES public.income_certifications(id) ON DELETE CASCADE,
  tenant_id          uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  relationship       text NOT NULL DEFAULT 'Head of Household',
  date_of_birth      date,
  is_full_time_student boolean NOT NULL DEFAULT false,
  annual_income      numeric(12,2) NOT NULL DEFAULT 0,
  income_source      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_household_members_cert ON public.household_members(certification_id);


-- ============================================================================
-- STEP 1D: ami_limits reference table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ami_limits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year            integer NOT NULL,
  area_name       text NOT NULL,
  state           text NOT NULL,
  household_size  integer NOT NULL,
  ami_30          numeric(12,2),
  ami_50          numeric(12,2),
  ami_60          numeric(12,2),
  ami_80          numeric(12,2),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, area_name, state, household_size)
);

CREATE INDEX idx_ami_limits_lookup ON public.ami_limits(year, area_name, state, household_size);


-- ============================================================================
-- STEP 1E: rent_limits reference table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rent_limits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  year            integer NOT NULL,
  area_name       text NOT NULL,
  state           text NOT NULL,
  bedroom_count   integer NOT NULL,
  max_rent_30     numeric(10,2),
  max_rent_50     numeric(10,2),
  max_rent_60     numeric(10,2),
  max_rent_80     numeric(10,2),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(year, area_name, state, bedroom_count)
);

CREATE INDEX idx_rent_limits_lookup ON public.rent_limits(year, area_name, state, bedroom_count);


-- ============================================================================
-- STEP 1F: compliance_alerts table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.compliance_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id       uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id           uuid REFERENCES public.units(id) ON DELETE CASCADE,
  tenant_id         uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  lease_id          uuid REFERENCES public.leases(id) ON DELETE SET NULL,
  certification_id  uuid REFERENCES public.income_certifications(id) ON DELETE SET NULL,
  alert_type        text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('Critical', 'Warning', 'Info')),
  message           text NOT NULL,
  due_date          date,
  resolved_at       timestamptz,
  resolved_by       uuid REFERENCES public.profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_alerts_property ON public.compliance_alerts(property_id);
CREATE INDEX idx_compliance_alerts_unresolved ON public.compliance_alerts(severity, created_at DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX idx_compliance_alerts_due ON public.compliance_alerts(due_date)
  WHERE resolved_at IS NULL;


-- ============================================================================
-- STEP 2: RLS policies
-- ============================================================================

-- income_certifications
ALTER TABLE public.income_certifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY income_certs_management_all
  ON public.income_certifications FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY income_certs_accounting_read
  ON public.income_certifications FOR SELECT
  TO authenticated
  USING ((SELECT public.get_my_role()) = 'Accounting');

CREATE POLICY income_certs_tenant_read
  ON public.income_certifications FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = income_certifications.lease_id
        AND l.user_id = (SELECT auth.uid())
    )
  );

-- household_members
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY household_members_management_all
  ON public.household_members FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY household_members_accounting_read
  ON public.household_members FOR SELECT
  TO authenticated
  USING ((SELECT public.get_my_role()) = 'Accounting');

-- ami_limits (reference — all authenticated can read, only management writes)
ALTER TABLE public.ami_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY ami_limits_read_all
  ON public.ami_limits FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY ami_limits_management_write
  ON public.ami_limits FOR INSERT
  TO authenticated
  WITH CHECK (public.is_management());

CREATE POLICY ami_limits_management_update
  ON public.ami_limits FOR UPDATE
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY ami_limits_management_delete
  ON public.ami_limits FOR DELETE
  TO authenticated
  USING (public.is_management());

-- rent_limits (same pattern)
ALTER TABLE public.rent_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY rent_limits_read_all
  ON public.rent_limits FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY rent_limits_management_write
  ON public.rent_limits FOR INSERT
  TO authenticated
  WITH CHECK (public.is_management());

CREATE POLICY rent_limits_management_update
  ON public.rent_limits FOR UPDATE
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY rent_limits_management_delete
  ON public.rent_limits FOR DELETE
  TO authenticated
  USING (public.is_management());

-- compliance_alerts
ALTER TABLE public.compliance_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY compliance_alerts_management_all
  ON public.compliance_alerts FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY compliance_alerts_accounting_read
  ON public.compliance_alerts FOR SELECT
  TO authenticated
  USING ((SELECT public.get_my_role()) = 'Accounting');


-- ============================================================================
-- STEP 3: RPC - create_income_certification
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_income_certification(
  p_tenant_id uuid,
  p_lease_id uuid,
  p_certification_date date,
  p_effective_date date,
  p_annual_income numeric,
  p_household_size integer,
  p_ami_percentage integer,
  p_certification_type text DEFAULT 'Initial',
  p_notes text DEFAULT NULL,
  p_student_status text DEFAULT 'None',
  p_household_members jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cert_id uuid;
  v_next_recert date;
  v_tenant_name text;
  v_property_name text;
  v_unit_name text;
  v_member jsonb;
BEGIN
  -- Validate caller is management
  IF NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied: management role required';
  END IF;

  -- Calculate next recertification date (1 year from effective)
  v_next_recert := p_effective_date + INTERVAL '1 year';

  -- Supersede any existing active certification for this lease
  UPDATE public.income_certifications
  SET status = 'Superseded', updated_at = now()
  WHERE lease_id = p_lease_id
    AND status = 'Active';

  -- Insert the new certification
  INSERT INTO public.income_certifications (
    tenant_id, lease_id, certification_date, effective_date,
    next_recertification_date, annual_income, household_size,
    ami_percentage_at_cert, certification_type, status,
    certified_by, notes, student_status
  ) VALUES (
    p_tenant_id, p_lease_id, p_certification_date, p_effective_date,
    v_next_recert, p_annual_income, p_household_size,
    p_ami_percentage, p_certification_type, 'Active',
    (SELECT auth.uid()), p_notes, p_student_status
  )
  RETURNING id INTO v_cert_id;

  -- Insert household members
  FOR v_member IN SELECT * FROM jsonb_array_elements(p_household_members)
  LOOP
    INSERT INTO public.household_members (
      certification_id, first_name, last_name, relationship,
      date_of_birth, is_full_time_student, annual_income, income_source
    ) VALUES (
      v_cert_id,
      v_member->>'first_name',
      v_member->>'last_name',
      COALESCE(v_member->>'relationship', 'Other'),
      CASE WHEN v_member->>'date_of_birth' IS NOT NULL
        THEN (v_member->>'date_of_birth')::date ELSE NULL END,
      COALESCE((v_member->>'is_full_time_student')::boolean, false),
      COALESCE((v_member->>'annual_income')::numeric, 0),
      v_member->>'income_source'
    );
  END LOOP;

  -- Get names for logging
  SELECT t.first_name || ' ' || t.last_name INTO v_tenant_name
  FROM public.tenants t WHERE t.id = p_tenant_id;

  SELECT p.name INTO v_property_name
  FROM public.properties p
  JOIN public.units u ON u.property_id = p.id
  JOIN public.leases l ON l.unit_id = u.id
  WHERE l.id = p_lease_id
  LIMIT 1;

  SELECT u.name INTO v_unit_name
  FROM public.units u
  JOIN public.leases l ON l.unit_id = u.id
  WHERE l.id = p_lease_id
  LIMIT 1;

  -- Log to system_activity
  INSERT INTO public.system_activity (event_type, title, description, actor_name)
  VALUES (
    'COMPLIANCE',
    'Income Certification Created',
    p_certification_type || ' certification for ' || COALESCE(v_tenant_name, 'Tenant') ||
    ' at ' || COALESCE(v_property_name, 'Property') || ' ' || COALESCE(v_unit_name, '') ||
    '. Income: $' || to_char(p_annual_income, 'FM999,999.00') ||
    ', AMI: ' || p_ami_percentage || '%',
    (SELECT full_name FROM public.profiles WHERE id = (SELECT auth.uid()))
  );

  RETURN v_cert_id;
END;
$$;


-- ============================================================================
-- STEP 4: RPC - check_compliance_status
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_compliance_status(
  p_property_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_alert_count integer := 0;
  v_unit RECORD;
  v_lease RECORD;
  v_cert RECORD;
BEGIN
  IF NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied: management role required';
  END IF;

  -- Clear stale unresolved alerts for properties we are scanning
  DELETE FROM public.compliance_alerts
  WHERE resolved_at IS NULL
    AND (p_property_id IS NULL OR property_id = p_property_id);

  -- Scan all restricted units
  FOR v_unit IN
    SELECT u.id AS unit_id, u.property_id, u.name AS unit_name,
           u.ami_percentage, u.max_gross_rent, u.utility_allowance,
           u.bedroom_count, u.is_restricted,
           p.name AS property_name
    FROM public.units u
    JOIN public.properties p ON p.id = u.property_id
    WHERE u.is_restricted = true
      AND p.is_affordable = true
      AND (p_property_id IS NULL OR u.property_id = p_property_id)
  LOOP
    -- Find active lease on this unit
    SELECT l.id AS lease_id, l.tenant_id, l.rent_amount,
           l.tenant_portion, l.subsidy_amount
    INTO v_lease
    FROM public.leases l
    WHERE l.unit_id = v_unit.unit_id AND l.status = 'Active'
    LIMIT 1;

    IF v_lease.lease_id IS NOT NULL THEN
      -- Check: rent exceeds max gross rent
      IF v_unit.max_gross_rent IS NOT NULL
         AND v_lease.rent_amount > v_unit.max_gross_rent THEN
        INSERT INTO public.compliance_alerts
          (property_id, unit_id, lease_id, tenant_id, alert_type, severity, message)
        VALUES (
          v_unit.property_id, v_unit.unit_id, v_lease.lease_id, v_lease.tenant_id,
          'RENT_OVER_LIMIT', 'Critical',
          v_unit.unit_name || ': Rent $' ||
          to_char(v_lease.rent_amount, 'FM999,999.00') ||
          ' exceeds max $' ||
          to_char(v_unit.max_gross_rent, 'FM999,999.00') ||
          ' for ' || v_unit.ami_percentage || '% AMI'
        );
        v_alert_count := v_alert_count + 1;
      END IF;

      -- Check: active income certification exists
      SELECT ic.id AS cert_id, ic.next_recertification_date,
             ic.annual_income, ic.ami_percentage_at_cert,
             ic.student_status
      INTO v_cert
      FROM public.income_certifications ic
      WHERE ic.lease_id = v_lease.lease_id AND ic.status = 'Active'
      ORDER BY ic.effective_date DESC
      LIMIT 1;

      IF v_cert.cert_id IS NULL THEN
        INSERT INTO public.compliance_alerts
          (property_id, unit_id, tenant_id, lease_id, alert_type, severity, message)
        VALUES (
          v_unit.property_id, v_unit.unit_id, v_lease.tenant_id, v_lease.lease_id,
          'MISSING_CERTIFICATION', 'Critical',
          v_unit.unit_name || ': No active income certification on file'
        );
        v_alert_count := v_alert_count + 1;
      ELSE
        -- Check: recertification overdue (>30 days past due)
        IF v_cert.next_recertification_date < CURRENT_DATE - INTERVAL '30 days' THEN
          INSERT INTO public.compliance_alerts
            (property_id, unit_id, tenant_id, lease_id, certification_id,
             alert_type, severity, message, due_date)
          VALUES (
            v_unit.property_id, v_unit.unit_id, v_lease.tenant_id, v_lease.lease_id,
            v_cert.cert_id,
            'RECERT_OVERDUE', 'Critical',
            v_unit.unit_name || ': Recertification overdue (due ' ||
            to_char(v_cert.next_recertification_date, 'MM/DD/YYYY') || ')',
            v_cert.next_recertification_date
          );
          v_alert_count := v_alert_count + 1;

        -- Check: recertification due within 90 days
        ELSIF v_cert.next_recertification_date <= CURRENT_DATE + INTERVAL '90 days' THEN
          INSERT INTO public.compliance_alerts
            (property_id, unit_id, tenant_id, lease_id, certification_id,
             alert_type, severity, message, due_date)
          VALUES (
            v_unit.property_id, v_unit.unit_id, v_lease.tenant_id, v_lease.lease_id,
            v_cert.cert_id,
            'RECERT_DUE_SOON', 'Warning',
            v_unit.unit_name || ': Recertification due ' ||
            to_char(v_cert.next_recertification_date, 'MM/DD/YYYY'),
            v_cert.next_recertification_date
          );
          v_alert_count := v_alert_count + 1;
        END IF;

        -- Check: all-student household ineligible
        IF v_cert.student_status = 'All-Ineligible' THEN
          INSERT INTO public.compliance_alerts
            (property_id, unit_id, tenant_id, lease_id, certification_id,
             alert_type, severity, message)
          VALUES (
            v_unit.property_id, v_unit.unit_id, v_lease.tenant_id, v_lease.lease_id,
            v_cert.cert_id,
            'STUDENT_INELIGIBLE', 'Critical',
            v_unit.unit_name || ': All-student household — ineligible under LIHTC'
          );
          v_alert_count := v_alert_count + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- Log the scan
  INSERT INTO public.system_activity (event_type, title, description, actor_name)
  VALUES (
    'COMPLIANCE',
    'Compliance Scan Completed',
    'Found ' || v_alert_count || ' alert(s)' ||
    CASE WHEN p_property_id IS NOT NULL
      THEN ' for property ' || (SELECT name FROM public.properties WHERE id = p_property_id)
      ELSE ' across all properties'
    END,
    (SELECT full_name FROM public.profiles WHERE id = (SELECT auth.uid()))
  );

  RETURN v_alert_count;
END;
$$;


-- ============================================================================
-- STEP 5: RPC - resolve_compliance_alert
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resolve_compliance_alert(
  p_alert_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied: management role required';
  END IF;

  UPDATE public.compliance_alerts
  SET resolved_at = now(),
      resolved_by = (SELECT auth.uid())
  WHERE id = p_alert_id AND resolved_at IS NULL;
END;
$$;


-- ============================================================================
-- STEP 6: Compliance dashboard view
-- ============================================================================

CREATE OR REPLACE VIEW public.compliance_dashboard_stats
WITH (security_invoker = true)
AS
SELECT
  p.id AS property_id,
  p.name AS property_name,
  p.program_types,
  COUNT(DISTINCT u.id) FILTER (WHERE u.is_restricted) AS total_restricted_units,
  COUNT(DISTINCT u.id) FILTER (
    WHERE u.is_restricted
    AND EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.income_certifications ic ON ic.lease_id = l.id
      WHERE l.unit_id = u.id AND l.status = 'Active' AND ic.status = 'Active'
    )
  ) AS units_with_active_cert,
  COUNT(DISTINCT ca.id) FILTER (WHERE ca.severity = 'Critical' AND ca.resolved_at IS NULL) AS critical_alerts,
  COUNT(DISTINCT ca.id) FILTER (WHERE ca.severity = 'Warning' AND ca.resolved_at IS NULL) AS warning_alerts,
  COUNT(DISTINCT ca.id) FILTER (WHERE ca.severity = 'Info' AND ca.resolved_at IS NULL) AS info_alerts
FROM public.properties p
LEFT JOIN public.units u ON u.property_id = p.id
LEFT JOIN public.compliance_alerts ca ON ca.property_id = p.id
WHERE p.is_affordable = true
GROUP BY p.id, p.name, p.program_types;


-- ============================================================================
-- STEP 7: Recreate lease_details_view with subsidy + affordability columns
-- ============================================================================

DROP VIEW IF EXISTS public.lease_details_view;
CREATE VIEW public.lease_details_view
WITH (security_invoker = true)
AS
SELECT
  l.id AS lease_id,
  p.name AS property_name,
  u.name AS unit_name,
  t.first_name,
  t.last_name,
  l.rent_amount,
  l.status,
  l.end_date,
  l.tenant_portion,
  l.subsidy_amount,
  l.subsidy_source,
  u.is_restricted,
  u.ami_percentage,
  u.max_gross_rent,
  u.utility_allowance
FROM public.leases l
JOIN public.units u ON l.unit_id = u.id
JOIN public.properties p ON u.property_id = p.id
JOIN public.tenants t ON l.tenant_id = t.id;


-- ============================================================================
-- STEP 8: Feature flag
-- ============================================================================

INSERT INTO public.feature_flags (key, value, description)
VALUES ('affordable_housing', true, 'Enable affordable housing compliance module')
ON CONFLICT (key) DO NOTHING;


COMMIT;
