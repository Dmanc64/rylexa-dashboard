-- 045: Renters Insurance Compliance
-- Adds insurance requirement tracking to properties, policy management per lease,
-- compliance scanning with alerts, and extends existing views.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. ALTER properties — add insurance columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS insurance_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS min_liability_amount numeric(10,2) DEFAULT 100000;

COMMENT ON COLUMN public.properties.insurance_required IS 'Whether tenants must carry renters insurance';
COMMENT ON COLUMN public.properties.min_liability_amount IS 'Minimum liability coverage required (default $100,000)';

-- ─────────────────────────────────────────────────────────────
-- 2. CREATE insurance_policies table
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.insurance_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  lease_id          uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  property_id       uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  carrier           text NOT NULL,
  policy_number     text NOT NULL,
  coverage_amount   numeric(12,2) NOT NULL,
  liability_amount  numeric(12,2) NOT NULL,
  effective_date    date NOT NULL,
  expiration_date   date NOT NULL,
  status            text NOT NULL DEFAULT 'Pending Review'
                    CHECK (status IN ('Active', 'Expired', 'Pending Review')),
  document_id       uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  verified_by       uuid REFERENCES public.profiles(id),
  verified_at       timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_insurance_policies_tenant ON public.insurance_policies(tenant_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_lease ON public.insurance_policies(lease_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_property ON public.insurance_policies(property_id);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_status ON public.insurance_policies(status);
CREATE INDEX IF NOT EXISTS idx_insurance_policies_expiration ON public.insurance_policies(expiration_date)
  WHERE status = 'Active';

-- ─────────────────────────────────────────────────────────────
-- 3. RLS for insurance_policies
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;

-- Management full access
CREATE POLICY insurance_policies_management_all
  ON public.insurance_policies FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- Tenant can read their own policies
CREATE POLICY insurance_policies_tenant_read
  ON public.insurance_policies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = insurance_policies.lease_id
        AND l.user_id = (SELECT auth.uid())
    )
  );

-- Tenant can insert for their own lease (portal self-service)
CREATE POLICY insurance_policies_tenant_insert
  ON public.insurance_policies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = insurance_policies.lease_id
        AND l.user_id = (SELECT auth.uid())
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 4. RPC: check_insurance_compliance
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.check_insurance_compliance(
  p_property_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_alert_count integer := 0;
  v_lease RECORD;
  v_policy RECORD;
  v_min_liability numeric;
BEGIN
  IF NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied: management role required';
  END IF;

  -- Clear stale unresolved insurance alerts for scanned properties
  DELETE FROM public.compliance_alerts
  WHERE resolved_at IS NULL
    AND alert_type IN ('MISSING_INSURANCE', 'INSURANCE_EXPIRED', 'INSURANCE_EXPIRING', 'INSURANCE_BELOW_MINIMUM')
    AND (p_property_id IS NULL OR property_id = p_property_id);

  -- Scan active leases on insurance-required properties
  FOR v_lease IN
    SELECT l.id AS lease_id, l.tenant_id, l.rent_amount,
           u.id AS unit_id, u.name AS unit_name,
           p.id AS prop_id, p.name AS property_name,
           p.min_liability_amount
    FROM public.leases l
    JOIN public.units u ON u.id = l.unit_id
    JOIN public.properties p ON p.id = u.property_id
    WHERE l.status = 'Active'
      AND p.insurance_required = true
      AND (p_property_id IS NULL OR p.id = p_property_id)
  LOOP
    v_min_liability := COALESCE(v_lease.min_liability_amount, 100000);

    -- Find latest active or most recent policy for this lease
    SELECT ip.id AS policy_id, ip.status, ip.expiration_date,
           ip.liability_amount, ip.carrier
    INTO v_policy
    FROM public.insurance_policies ip
    WHERE ip.lease_id = v_lease.lease_id
    ORDER BY
      CASE ip.status WHEN 'Active' THEN 0 WHEN 'Pending Review' THEN 1 ELSE 2 END,
      ip.created_at DESC
    LIMIT 1;

    IF v_policy.policy_id IS NULL THEN
      -- No policy at all
      INSERT INTO public.compliance_alerts
        (property_id, unit_id, tenant_id, lease_id, alert_type, severity, message)
      VALUES (
        v_lease.prop_id, v_lease.unit_id, v_lease.tenant_id, v_lease.lease_id,
        'MISSING_INSURANCE', 'Critical',
        v_lease.unit_name || ': No renters insurance on file'
      );
      v_alert_count := v_alert_count + 1;

    ELSIF v_policy.status = 'Expired' OR v_policy.expiration_date < CURRENT_DATE THEN
      -- Policy expired
      INSERT INTO public.compliance_alerts
        (property_id, unit_id, tenant_id, lease_id, alert_type, severity, message, due_date)
      VALUES (
        v_lease.prop_id, v_lease.unit_id, v_lease.tenant_id, v_lease.lease_id,
        'INSURANCE_EXPIRED', 'Critical',
        v_lease.unit_name || ': Insurance expired ' ||
        to_char(v_policy.expiration_date, 'MM/DD/YYYY') ||
        ' (' || v_policy.carrier || ')',
        v_policy.expiration_date
      );
      v_alert_count := v_alert_count + 1;

    ELSIF v_policy.status = 'Active' THEN
      -- Check: expiring within 30 days
      IF v_policy.expiration_date <= CURRENT_DATE + INTERVAL '30 days' THEN
        INSERT INTO public.compliance_alerts
          (property_id, unit_id, tenant_id, lease_id, alert_type, severity, message, due_date)
        VALUES (
          v_lease.prop_id, v_lease.unit_id, v_lease.tenant_id, v_lease.lease_id,
          'INSURANCE_EXPIRING', 'Warning',
          v_lease.unit_name || ': Insurance expiring ' ||
          to_char(v_policy.expiration_date, 'MM/DD/YYYY') ||
          ' (' || v_policy.carrier || ')',
          v_policy.expiration_date
        );
        v_alert_count := v_alert_count + 1;
      END IF;

      -- Check: liability below minimum
      IF v_policy.liability_amount < v_min_liability THEN
        INSERT INTO public.compliance_alerts
          (property_id, unit_id, tenant_id, lease_id, alert_type, severity, message)
        VALUES (
          v_lease.prop_id, v_lease.unit_id, v_lease.tenant_id, v_lease.lease_id,
          'INSURANCE_BELOW_MINIMUM', 'Warning',
          v_lease.unit_name || ': Liability $' ||
          to_char(v_policy.liability_amount, 'FM999,999') ||
          ' below required $' ||
          to_char(v_min_liability, 'FM999,999')
        );
        v_alert_count := v_alert_count + 1;
      END IF;
    END IF;
  END LOOP;

  -- Log the scan
  INSERT INTO public.system_activity (event_type, title, description, actor_name)
  VALUES (
    'COMPLIANCE',
    'Insurance Compliance Scan',
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

-- ─────────────────────────────────────────────────────────────
-- 5. RPC: verify_insurance_policy
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_insurance_policy(
  p_policy_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease_id uuid;
BEGIN
  IF NOT public.is_management() THEN
    RAISE EXCEPTION 'Access denied: management role required';
  END IF;

  -- Get lease_id for this policy
  SELECT lease_id INTO v_lease_id
  FROM public.insurance_policies
  WHERE id = p_policy_id;

  IF v_lease_id IS NULL THEN
    RAISE EXCEPTION 'Policy not found';
  END IF;

  -- Expire any previously active policy for the same lease
  UPDATE public.insurance_policies
  SET status = 'Expired', updated_at = now()
  WHERE lease_id = v_lease_id
    AND status = 'Active'
    AND id != p_policy_id;

  -- Activate this policy
  UPDATE public.insurance_policies
  SET status = 'Active',
      verified_by = (SELECT auth.uid()),
      verified_at = now(),
      updated_at = now()
  WHERE id = p_policy_id;

  -- Log
  INSERT INTO public.system_activity (event_type, title, description, actor_name)
  VALUES (
    'COMPLIANCE',
    'Insurance Policy Verified',
    'Policy ' || p_policy_id || ' activated for lease ' || v_lease_id,
    (SELECT full_name FROM public.profiles WHERE id = (SELECT auth.uid()))
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. Recreate compliance_dashboard_stats — add insurance columns
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.compliance_dashboard_stats
WITH (security_invoker = true)
AS
SELECT
  p.id AS property_id,
  p.name AS property_name,
  p.program_types,
  p.is_affordable,
  p.insurance_required,
  p.min_liability_amount,
  -- Affordable housing stats
  COUNT(DISTINCT u.id) FILTER (WHERE u.is_restricted) AS total_restricted_units,
  COUNT(DISTINCT u.id) FILTER (
    WHERE u.is_restricted
    AND EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.income_certifications ic ON ic.lease_id = l.id
      WHERE l.unit_id = u.id AND l.status = 'Active' AND ic.status = 'Active'
    )
  ) AS units_with_active_cert,
  -- Insurance stats
  COUNT(DISTINCT l_ins.id) FILTER (WHERE l_ins.status = 'Active') AS total_insurable_leases,
  COUNT(DISTINCT l_ins.id) FILTER (
    WHERE l_ins.status = 'Active'
    AND EXISTS (
      SELECT 1 FROM public.insurance_policies ip
      WHERE ip.lease_id = l_ins.id AND ip.status = 'Active'
    )
  ) AS leases_with_active_insurance,
  -- Alert counts (all compliance types combined)
  COUNT(DISTINCT ca.id) FILTER (WHERE ca.severity = 'Critical' AND ca.resolved_at IS NULL) AS critical_alerts,
  COUNT(DISTINCT ca.id) FILTER (WHERE ca.severity = 'Warning' AND ca.resolved_at IS NULL) AS warning_alerts,
  COUNT(DISTINCT ca.id) FILTER (WHERE ca.severity = 'Info' AND ca.resolved_at IS NULL) AS info_alerts
FROM public.properties p
LEFT JOIN public.units u ON u.property_id = p.id
LEFT JOIN public.leases l_ins ON l_ins.unit_id = u.id AND p.insurance_required = true
LEFT JOIN public.compliance_alerts ca ON ca.property_id = p.id
WHERE p.is_affordable = true OR p.insurance_required = true
GROUP BY p.id, p.name, p.program_types, p.is_affordable, p.insurance_required, p.min_liability_amount;

-- ─────────────────────────────────────────────────────────────
-- 7. Recreate lease_details_view — add insurance columns
-- ─────────────────────────────────────────────────────────────
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
  -- Affordability fields
  l.tenant_portion,
  l.subsidy_amount,
  l.subsidy_source,
  u.is_restricted,
  u.ami_percentage,
  u.max_gross_rent,
  u.utility_allowance,
  -- Insurance fields
  p.insurance_required,
  (SELECT ip.status FROM public.insurance_policies ip
   WHERE ip.lease_id = l.id AND ip.status = 'Active'
   ORDER BY ip.created_at DESC LIMIT 1) AS insurance_status,
  (SELECT ip.expiration_date FROM public.insurance_policies ip
   WHERE ip.lease_id = l.id AND ip.status = 'Active'
   ORDER BY ip.created_at DESC LIMIT 1) AS insurance_expiration
FROM public.leases l
JOIN public.units u ON l.unit_id = u.id
JOIN public.properties p ON u.property_id = p.id
JOIN public.tenants t ON l.tenant_id = t.id;

-- ─────────────────────────────────────────────────────────────
-- 8. Feature flag
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description)
VALUES ('renters_insurance', true, 'Enable renters insurance compliance tracking')
ON CONFLICT (key) DO NOTHING;

COMMIT;
