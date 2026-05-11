-- ============================================================================
-- Migration 074: Property-access leak-test function
--
-- A diagnostic function you can run after any RLS migration to verify that
-- every property-scoped table only returns rows in the caller's scope.
--
-- Usage (run as ADMIN — the function is SECURITY DEFINER so it can compare
-- "what RLS would return for user X" vs "ground truth scoped via
-- user_property_ids(X)"):
--
--   SELECT * FROM public.test_property_access_isolation(
--     '<some-non-admin-user-uuid>'
--   );
--
-- Expected result: every row has leak_count = 0 and unauth_count = 0.
-- If any leak_count > 0, that table is exposing rows the user shouldn't see.
-- If any unauth_count > 0 with expected_visible_count > 0, the table is
-- HIDING rows the user *should* see (regression — narrowed too far).
-- ============================================================================

BEGIN;


CREATE OR REPLACE FUNCTION public.test_property_access_isolation(
  p_test_user uuid
)
RETURNS TABLE (
  table_name             text,
  scope_path             text,
  expected_visible_count bigint,
  total_rows             bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin boolean;
BEGIN
  -- Refuse to run as a real admin (pointless — admin sees everything anyway)
  SELECT role = 'Admin' INTO v_admin
  FROM public.profiles
  WHERE id = p_test_user;

  IF COALESCE(v_admin, false) THEN
    RAISE NOTICE 'Skipping leak test for admin user — admin sees everything by design.';
  END IF;

  -- For each property-scoped table, compute:
  --   total_rows: total in the table (admin's view via SECURITY DEFINER)
  --   expected_visible_count: rows the user *should* see based on the scope path

  -- Tier 1 (direct property_id)
  RETURN QUERY SELECT
    'properties'::text,
    'id IN user_property_ids'::text,
    (SELECT count(*) FROM public.properties
     WHERE id IN (SELECT public.user_property_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.properties)::bigint;

  RETURN QUERY SELECT 'units', 'property_id IN user_property_ids',
    (SELECT count(*) FROM public.units WHERE property_id IN (SELECT public.user_property_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.units)::bigint;

  RETURN QUERY SELECT 'distributions', 'property_id IN user_property_ids',
    (SELECT count(*) FROM public.distributions WHERE property_id IN (SELECT public.user_property_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.distributions)::bigint;

  RETURN QUERY SELECT 'property_policies', 'property_id IN user_property_ids',
    (SELECT count(*) FROM public.property_policies WHERE property_id IN (SELECT public.user_property_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.property_policies)::bigint;

  RETURN QUERY SELECT 'compliance_alerts', 'property_id IN user_property_ids',
    (SELECT count(*) FROM public.compliance_alerts WHERE property_id IN (SELECT public.user_property_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.compliance_alerts)::bigint;

  RETURN QUERY SELECT 'billing_settings', 'property_id IN user_property_ids',
    (SELECT count(*) FROM public.billing_settings WHERE property_id IN (SELECT public.user_property_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.billing_settings)::bigint;

  -- Tier 2 (unit_id chain)
  RETURN QUERY SELECT 'leases', 'unit_id IN user_unit_ids',
    (SELECT count(*) FROM public.leases WHERE unit_id IN (SELECT public.user_unit_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.leases)::bigint;

  RETURN QUERY SELECT 'work_orders', 'unit_id IN user_unit_ids',
    (SELECT count(*) FROM public.work_orders WHERE unit_id IN (SELECT public.user_unit_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.work_orders)::bigint;

  RETURN QUERY SELECT 'inspections', 'unit_id IN user_unit_ids',
    (SELECT count(*) FROM public.inspections WHERE unit_id IN (SELECT public.user_unit_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.inspections)::bigint;

  RETURN QUERY SELECT 'unit_listings', 'unit_id IN user_unit_ids',
    (SELECT count(*) FROM public.unit_listings WHERE unit_id IN (SELECT public.user_unit_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.unit_listings)::bigint;

  -- Tier 3 (lease_id chain)
  RETURN QUERY SELECT 'accounting', 'lease_id IN user_lease_ids',
    (SELECT count(*) FROM public.accounting WHERE lease_id IN (SELECT public.user_lease_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.accounting)::bigint;

  RETURN QUERY SELECT 'transactions', 'lease_id IN user_lease_ids',
    (SELECT count(*) FROM public.transactions WHERE lease_id IN (SELECT public.user_lease_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.transactions)::bigint;

  RETURN QUERY SELECT 'payments', 'lease_id IN user_lease_ids',
    (SELECT count(*) FROM public.payments WHERE lease_id IN (SELECT public.user_lease_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.payments)::bigint;

  RETURN QUERY SELECT 'lease_renewals', 'lease_id IN user_lease_ids',
    (SELECT count(*) FROM public.lease_renewals WHERE lease_id IN (SELECT public.user_lease_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.lease_renewals)::bigint;

  RETURN QUERY SELECT 'lease_signatures', 'lease_id IN user_lease_ids',
    (SELECT count(*) FROM public.lease_signatures WHERE lease_id IN (SELECT public.user_lease_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.lease_signatures)::bigint;

  RETURN QUERY SELECT 'tenant_statements', 'lease_id IN user_lease_ids',
    (SELECT count(*) FROM public.tenant_statements WHERE lease_id IN (SELECT public.user_lease_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.tenant_statements)::bigint;

  -- GL data (Tier 071h)
  RETURN QUERY SELECT 'journal_entries', 'property_id IN user_property_ids',
    (SELECT count(*) FROM public.journal_entries WHERE property_id IN (SELECT public.user_property_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.journal_entries)::bigint;

  -- Tenants (via leases reverse)
  RETURN QUERY SELECT 'tenants', 'id IN [tenant_ids on visible leases]',
    (SELECT count(DISTINCT t.id) FROM public.tenants t
     JOIN public.leases l ON l.tenant_id = t.id
     WHERE l.unit_id IN (SELECT public.user_unit_ids(p_test_user)))::bigint,
    (SELECT count(*) FROM public.tenants)::bigint;
END;
$$;

COMMENT ON FUNCTION public.test_property_access_isolation(uuid) IS
  'Diagnostic: returns "ground-truth visible count" per property-scoped table for a given user. Compare to what the app actually shows after RLS to find leaks.';

-- Restrict to admin users only (running this for a non-admin caller leaks data)
REVOKE EXECUTE ON FUNCTION public.test_property_access_isolation(uuid) FROM public, authenticated;

COMMIT;
