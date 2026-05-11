-- ============================================================================
-- Migration 071a: Tier 1 RLS Rewrite + PM/Accounting Backfill Safety Net
--
-- Tables affected (Tier 1 = direct property_id link):
--   1. properties           (scoped by id)
--   2. units                (scoped by property_id)
--   3. billing_settings     (scoped by property_id)
--   4. compliance_alerts    (scoped by property_id)
--   5. distributions        (scoped by property_id + owner_id)
--   6. property_policies    (scoped by property_id)
--
-- Three phases:
--   Phase 1: Backfill — every active PM and Accounting user gets explicit
--            grants on every existing property. Idempotent (ON CONFLICT).
--   Phase 2: Drop existing broad policies (is_management, is_staff,
--            get_my_role-based). Tenant/Vendor relationship-scoped policies
--            are preserved.
--   Phase 3: Create new scoped policies using user_property_ids() and
--            user_can_manage_property() helpers. Add Maintenance read paths
--            (was relying on is_staff() globally).
--
-- Authorization model post-migration:
--   SELECT  → user_property_ids() membership
--   INSERT  → Admin only (on root tables: properties)
--   INSERT  → user_can_manage_property() (on child tables: units, etc.)
--   UPDATE  → user_can_manage_property() (Admin or 'Property Manager' grant)
--   DELETE  → Admin only (on root tables) / user_can_manage_property() (children)
--
-- ROLLBACK: redrop new policies and recreate the old ones. The backfill
--           rows can be left alone (they're harmless if RLS reverts).
-- ============================================================================

BEGIN;

-- ============================================================================
-- PHASE 1: Backfill safety net
--
-- Without this, the moment policies narrow, every existing PM/Accounting user
-- would see zero properties (their property_access rows are empty until now).
-- ============================================================================

-- Property Managers → 'Property Manager' / 'full' on every property
INSERT INTO public.property_access (property_id, user_id, access_level, permission_tier, notes)
SELECT
  p.id,
  pr.id,
  'Property Manager',
  'full',
  'Auto-backfilled by migration 071a'
FROM public.properties p
CROSS JOIN public.profiles pr
WHERE pr.role = 'Property Manager' AND COALESCE(pr.is_active, true)
ON CONFLICT (property_id, user_id, access_level) DO NOTHING;

-- Accounting → 'Accounting' / 'full' on every property
INSERT INTO public.property_access (property_id, user_id, access_level, permission_tier, notes)
SELECT
  p.id,
  pr.id,
  'Accounting',
  'full',
  'Auto-backfilled by migration 071a'
FROM public.properties p
CROSS JOIN public.profiles pr
WHERE pr.role = 'Accounting' AND COALESCE(pr.is_active, true)
ON CONFLICT (property_id, user_id, access_level) DO NOTHING;


-- ============================================================================
-- PHASE 2 + 3: For each Tier 1 table, drop broad policies and add scoped ones
-- ============================================================================

-- ---- properties --------------------------------------------------------
DROP POLICY IF EXISTS "Accounting read properties"          ON public.properties;
DROP POLICY IF EXISTS "Management insert properties"        ON public.properties;
DROP POLICY IF EXISTS "Management update properties"        ON public.properties;
DROP POLICY IF EXISTS "Owners read own properties"          ON public.properties;
DROP POLICY IF EXISTS "Staff read properties"               ON public.properties;

CREATE POLICY "properties_scoped_read" ON public.properties
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.user_property_ids()));

CREATE POLICY "properties_admin_insert" ON public.properties
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "properties_scoped_update" ON public.properties
  FOR UPDATE TO authenticated
  USING (public.user_can_manage_property(id))
  WITH CHECK (public.user_can_manage_property(id));

CREATE POLICY "properties_admin_delete" ON public.properties
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- Maintenance staff read properties only via assigned work orders
CREATE POLICY "properties_maintenance_via_work_orders" ON public.properties
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'Maintenance'
    AND id IN (
      SELECT u.property_id
      FROM public.units u
      JOIN public.work_orders wo ON wo.unit_id = u.id
      WHERE wo.assigned_to = (SELECT auth.uid())
    )
  );

-- Preserved (relationship-scoped, untouched):
--   "Tenants read own property" (Tenant via lease chain)
--   "Vendors read assigned properties" (Vendor via work_orders)


-- ---- units --------------------------------------------------------------
DROP POLICY IF EXISTS "Accounting read units"     ON public.units;
DROP POLICY IF EXISTS "Management insert units"   ON public.units;
DROP POLICY IF EXISTS "Management update units"   ON public.units;
DROP POLICY IF EXISTS "Staff read units"          ON public.units;

CREATE POLICY "units_scoped_read" ON public.units
  FOR SELECT TO authenticated
  USING (property_id IN (SELECT public.user_property_ids()));

CREATE POLICY "units_scoped_insert" ON public.units
  FOR INSERT TO authenticated
  WITH CHECK (public.user_can_manage_property(property_id));

CREATE POLICY "units_scoped_update" ON public.units
  FOR UPDATE TO authenticated
  USING (public.user_can_manage_property(property_id))
  WITH CHECK (public.user_can_manage_property(property_id));

CREATE POLICY "units_scoped_delete" ON public.units
  FOR DELETE TO authenticated
  USING (public.user_can_manage_property(property_id));

-- Maintenance staff read units only via assigned work orders
CREATE POLICY "units_maintenance_via_work_orders" ON public.units
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'Maintenance'
    AND id IN (
      SELECT wo.unit_id
      FROM public.work_orders wo
      WHERE wo.assigned_to = (SELECT auth.uid())
    )
  );

-- Preserved:
--   "Tenants read own unit"
--   "Vendors read assigned units"


-- ---- billing_settings --------------------------------------------------
DROP POLICY IF EXISTS "billing_settings_finance_read"        ON public.billing_settings;
DROP POLICY IF EXISTS "billing_settings_management_all"      ON public.billing_settings;

CREATE POLICY "billing_settings_scoped_read" ON public.billing_settings
  FOR SELECT TO authenticated
  USING (property_id IN (SELECT public.user_property_ids()));

CREATE POLICY "billing_settings_scoped_write" ON public.billing_settings
  FOR ALL TO authenticated
  USING (public.user_can_manage_property(property_id))
  WITH CHECK (public.user_can_manage_property(property_id));


-- ---- compliance_alerts -------------------------------------------------
DROP POLICY IF EXISTS "compliance_alerts_accounting_read"    ON public.compliance_alerts;
DROP POLICY IF EXISTS "compliance_alerts_management_all"     ON public.compliance_alerts;

CREATE POLICY "compliance_alerts_scoped_read" ON public.compliance_alerts
  FOR SELECT TO authenticated
  USING (property_id IN (SELECT public.user_property_ids()));

CREATE POLICY "compliance_alerts_scoped_write" ON public.compliance_alerts
  FOR ALL TO authenticated
  USING (public.user_can_manage_property(property_id))
  WITH CHECK (public.user_can_manage_property(property_id));


-- ---- distributions -----------------------------------------------------
DROP POLICY IF EXISTS "Accounting read distributions"             ON public.distributions;
DROP POLICY IF EXISTS "Management full access to distributions"   ON public.distributions;
DROP POLICY IF EXISTS "Owners read own distributions"             ON public.distributions;

-- Read: property scope OR owner-entity membership
CREATE POLICY "distributions_scoped_read" ON public.distributions
  FOR SELECT TO authenticated
  USING (
    property_id IN (SELECT public.user_property_ids())
    OR owner_id IN (SELECT public.my_owner_entity_ids())
  );

-- Write: only Admin or Accounting/full or PM (i.e., post-financials capable)
CREATE POLICY "distributions_scoped_write" ON public.distributions
  FOR ALL TO authenticated
  USING (public.user_can_post_financials(property_id))
  WITH CHECK (public.user_can_post_financials(property_id));


-- ---- property_policies -------------------------------------------------
DROP POLICY IF EXISTS "Management full access to policies"                  ON public.property_policies;
DROP POLICY IF EXISTS "Owners read policies for their properties"           ON public.property_policies;
DROP POLICY IF EXISTS "Tenants read active policies for their property"     ON public.property_policies;

CREATE POLICY "property_policies_scoped_read" ON public.property_policies
  FOR SELECT TO authenticated
  USING (property_id IN (SELECT public.user_property_ids()));

CREATE POLICY "property_policies_scoped_write" ON public.property_policies
  FOR ALL TO authenticated
  USING (public.user_can_manage_property(property_id))
  WITH CHECK (public.user_can_manage_property(property_id));

-- Tenants can still read their property's active policies
CREATE POLICY "property_policies_tenant_read" ON public.property_policies
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'Tenant'
    AND is_active = true
    AND property_id IN (
      SELECT u.property_id
      FROM public.units u
      JOIN public.leases l ON l.unit_id = u.id
      WHERE l.user_id = (SELECT auth.uid())
    )
  );

COMMIT;
