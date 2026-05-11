-- ============================================================================
-- Migration 071b: Tier 2 RLS Rewrite (via unit_id → property scope)
--
-- Tables (Tier 2 = unit_id direct OR child of a unit-scoped table):
--   1.  leases            (unit_id, nullable)
--   2.  work_orders       (unit_id, nullable)
--   3.  inspections       (unit_id, NOT NULL)
--   4.  inspection_areas  (inspection_id → inspections.unit_id)
--   5.  inspection_photos (area_id → inspection_areas → inspections.unit_id)
--   6.  unit_listings     (unit_id, NOT NULL)
--   7.  unit_turns        (unit_id, NOT NULL)
--   8.  turn_tasks        (turn_id → unit_turns.unit_id)
--   9.  tours             (unit_id, nullable)
--   10. applications      (unit_id, nullable)
--
-- Helpers added (this migration):
--   user_unit_ids(uuid)         SETOF uuid — units in the user's property scope
--   user_can_manage_unit(uuid)  boolean    — can write data on this unit
--
-- Preserved (relationship-scoped, untouched):
--   "Tenants read own lease", "Tenants insert/read work_orders"
--   "Vendors read/update assigned work_orders", "Vendors read biddable work_orders"
--   "Owners/Tenants read shared inspections" (and areas/photos)
--   "Public read published unit_listings", "Public can submit applications"
--   "turn_tasks_vendor_read"
--
-- Nullable unit_id rows: only Admin sees them. Forces data integrity for the
-- few cases where a row exists without a unit assignment.
-- ============================================================================

BEGIN;


-- ============================================================================
-- Helper: user_unit_ids() — units in the user's property scope
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_unit_ids(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT u.id
  FROM public.units u
  WHERE u.property_id IN (SELECT public.user_property_ids(p_user_id));
$$;

COMMENT ON FUNCTION public.user_unit_ids(uuid) IS
  'Returns unit IDs visible to a user via their property scope. Used by Tier 2 RLS policies.';

GRANT EXECUTE ON FUNCTION public.user_unit_ids(uuid) TO authenticated;


-- ============================================================================
-- Helper: user_can_manage_unit() — write authorization on a specific unit
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_can_manage_unit(
  p_unit_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT public.user_can_manage_property(
    (SELECT property_id FROM public.units WHERE id = p_unit_id),
    p_user_id
  );
$$;

COMMENT ON FUNCTION public.user_can_manage_unit(uuid, uuid) IS
  'True if the user can write data on rows linked to this unit (via property scope).';

GRANT EXECUTE ON FUNCTION public.user_can_manage_unit(uuid, uuid) TO authenticated;


-- ============================================================================
-- 1. LEASES
-- ============================================================================

DROP POLICY IF EXISTS "Accounting read leases"     ON public.leases;
DROP POLICY IF EXISTS "Maintenance read leases"    ON public.leases;
DROP POLICY IF EXISTS "Management manage leases"   ON public.leases;

CREATE POLICY "leases_scoped_read" ON public.leases
  FOR SELECT TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids())
    OR (unit_id IS NULL AND public.is_admin())
  );

CREATE POLICY "leases_scoped_insert" ON public.leases
  FOR INSERT TO authenticated
  WITH CHECK (
    (unit_id IS NOT NULL AND public.user_can_manage_unit(unit_id))
    OR (unit_id IS NULL AND public.is_admin())
  );

CREATE POLICY "leases_scoped_update" ON public.leases
  FOR UPDATE TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id)
  )
  WITH CHECK (
    unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id)
  );

CREATE POLICY "leases_scoped_delete" ON public.leases
  FOR DELETE TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id)
  );

-- Maintenance can read leases for units they have assigned work orders on
CREATE POLICY "leases_maintenance_via_work_orders" ON public.leases
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'Maintenance'
    AND unit_id IN (
      SELECT wo.unit_id FROM public.work_orders wo
      WHERE wo.assigned_to = (SELECT auth.uid())
    )
  );

-- Preserved (relationship-scoped, untouched):
--   "Tenants read own lease"


-- ============================================================================
-- 2. WORK_ORDERS
-- ============================================================================

DROP POLICY IF EXISTS "Maintenance read work_orders"    ON public.work_orders;
DROP POLICY IF EXISTS "Maintenance update work_orders"  ON public.work_orders;
DROP POLICY IF EXISTS "Management manage work_orders"   ON public.work_orders;

CREATE POLICY "work_orders_scoped_read" ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids())
    OR (unit_id IS NULL AND public.is_admin())
  );

CREATE POLICY "work_orders_scoped_insert" ON public.work_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    (unit_id IS NOT NULL AND public.user_can_manage_unit(unit_id))
    OR (unit_id IS NULL AND public.is_admin())
  );

CREATE POLICY "work_orders_scoped_update" ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id)
  )
  WITH CHECK (
    unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id)
  );

CREATE POLICY "work_orders_scoped_delete" ON public.work_orders
  FOR DELETE TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id)
  );

-- Maintenance read/update via assigned_to (replaces the unscoped policies)
CREATE POLICY "work_orders_maintenance_assigned_read" ON public.work_orders
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() = 'Maintenance'
    AND assigned_to = (SELECT auth.uid())
  );

CREATE POLICY "work_orders_maintenance_assigned_update" ON public.work_orders
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'Maintenance'
    AND assigned_to = (SELECT auth.uid())
  )
  WITH CHECK (
    public.get_my_role() = 'Maintenance'
    AND assigned_to = (SELECT auth.uid())
  );

-- Preserved (relationship-scoped, untouched):
--   "Tenants insert work_orders", "Tenants read own work_orders"
--   "Vendors read assigned work_orders", "Vendors read biddable work_orders"
--   "Vendors update assigned work_orders"


-- ============================================================================
-- 3. INSPECTIONS
-- ============================================================================

DROP POLICY IF EXISTS "Management full access to inspections" ON public.inspections;

CREATE POLICY "inspections_scoped_read" ON public.inspections
  FOR SELECT TO authenticated
  USING (unit_id IN (SELECT public.user_unit_ids()));

CREATE POLICY "inspections_scoped_write" ON public.inspections
  FOR ALL TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids())
    AND public.user_can_manage_unit(unit_id)
  )
  WITH CHECK (
    unit_id IN (SELECT public.user_unit_ids())
    AND public.user_can_manage_unit(unit_id)
  );

-- Preserved:
--   "Owners read shared inspections", "Tenants read shared inspections"


-- ============================================================================
-- 4. INSPECTION_AREAS  (scoped via inspection_id → inspections.unit_id)
-- ============================================================================

DROP POLICY IF EXISTS "Management full access to inspection_areas" ON public.inspection_areas;

CREATE POLICY "inspection_areas_scoped_read" ON public.inspection_areas
  FOR SELECT TO authenticated
  USING (
    inspection_id IN (
      SELECT id FROM public.inspections
      WHERE unit_id IN (SELECT public.user_unit_ids())
    )
  );

CREATE POLICY "inspection_areas_scoped_write" ON public.inspection_areas
  FOR ALL TO authenticated
  USING (
    inspection_id IN (
      SELECT id FROM public.inspections
      WHERE unit_id IN (SELECT public.user_unit_ids())
        AND public.user_can_manage_unit(unit_id)
    )
  )
  WITH CHECK (
    inspection_id IN (
      SELECT id FROM public.inspections
      WHERE unit_id IN (SELECT public.user_unit_ids())
        AND public.user_can_manage_unit(unit_id)
    )
  );

-- Preserved:
--   "Owners read shared inspection areas", "Tenants read shared inspection areas"


-- ============================================================================
-- 5. INSPECTION_PHOTOS  (scoped via area_id → inspection_areas → inspections.unit_id)
-- ============================================================================

DROP POLICY IF EXISTS "Management full access to inspection_photos" ON public.inspection_photos;

CREATE POLICY "inspection_photos_scoped_read" ON public.inspection_photos
  FOR SELECT TO authenticated
  USING (
    area_id IN (
      SELECT ia.id
      FROM public.inspection_areas ia
      JOIN public.inspections i ON i.id = ia.inspection_id
      WHERE i.unit_id IN (SELECT public.user_unit_ids())
    )
  );

CREATE POLICY "inspection_photos_scoped_write" ON public.inspection_photos
  FOR ALL TO authenticated
  USING (
    area_id IN (
      SELECT ia.id
      FROM public.inspection_areas ia
      JOIN public.inspections i ON i.id = ia.inspection_id
      WHERE i.unit_id IN (SELECT public.user_unit_ids())
        AND public.user_can_manage_unit(i.unit_id)
    )
  )
  WITH CHECK (
    area_id IN (
      SELECT ia.id
      FROM public.inspection_areas ia
      JOIN public.inspections i ON i.id = ia.inspection_id
      WHERE i.unit_id IN (SELECT public.user_unit_ids())
        AND public.user_can_manage_unit(i.unit_id)
    )
  );

-- Preserved:
--   "Owners read shared inspection photos", "Tenants read shared inspection photos"


-- ============================================================================
-- 6. UNIT_LISTINGS
-- ============================================================================

DROP POLICY IF EXISTS "Management full access to unit_listings" ON public.unit_listings;
DROP POLICY IF EXISTS "Staff read unit_listings"                ON public.unit_listings;

CREATE POLICY "unit_listings_scoped_read" ON public.unit_listings
  FOR SELECT TO authenticated
  USING (unit_id IN (SELECT public.user_unit_ids()));

CREATE POLICY "unit_listings_scoped_write" ON public.unit_listings
  FOR ALL TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids())
    AND public.user_can_manage_unit(unit_id)
  )
  WITH CHECK (
    unit_id IN (SELECT public.user_unit_ids())
    AND public.user_can_manage_unit(unit_id)
  );

-- Preserved:
--   "Public read published unit_listings" (status = 'published') — public listing pages


-- ============================================================================
-- 7. UNIT_TURNS
-- ============================================================================

DROP POLICY IF EXISTS "unit_turns_management_all"        ON public.unit_turns;
DROP POLICY IF EXISTS "unit_turns_maintenance_read"      ON public.unit_turns;

CREATE POLICY "unit_turns_scoped_read" ON public.unit_turns
  FOR SELECT TO authenticated
  USING (unit_id IN (SELECT public.user_unit_ids()));

CREATE POLICY "unit_turns_scoped_write" ON public.unit_turns
  FOR ALL TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids())
    AND public.user_can_manage_unit(unit_id)
  )
  WITH CHECK (
    unit_id IN (SELECT public.user_unit_ids())
    AND public.user_can_manage_unit(unit_id)
  );


-- ============================================================================
-- 8. TURN_TASKS  (scoped via turn_id → unit_turns.unit_id)
-- ============================================================================

DROP POLICY IF EXISTS "turn_tasks_management_all"     ON public.turn_tasks;
DROP POLICY IF EXISTS "turn_tasks_maintenance_all"    ON public.turn_tasks;

CREATE POLICY "turn_tasks_scoped_read" ON public.turn_tasks
  FOR SELECT TO authenticated
  USING (
    turn_id IN (
      SELECT id FROM public.unit_turns
      WHERE unit_id IN (SELECT public.user_unit_ids())
    )
  );

CREATE POLICY "turn_tasks_scoped_write" ON public.turn_tasks
  FOR ALL TO authenticated
  USING (
    turn_id IN (
      SELECT id FROM public.unit_turns
      WHERE unit_id IN (SELECT public.user_unit_ids())
        AND public.user_can_manage_unit(unit_id)
    )
  )
  WITH CHECK (
    turn_id IN (
      SELECT id FROM public.unit_turns
      WHERE unit_id IN (SELECT public.user_unit_ids())
        AND public.user_can_manage_unit(unit_id)
    )
  );

-- Preserved:
--   "turn_tasks_vendor_read" (vendor email match — already scoped correctly)


-- ============================================================================
-- 9. TOURS
-- ============================================================================

DROP POLICY IF EXISTS "tours_management_all" ON public.tours;

CREATE POLICY "tours_scoped_read" ON public.tours
  FOR SELECT TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids())
    OR (unit_id IS NULL AND public.is_admin())
  );

CREATE POLICY "tours_scoped_write" ON public.tours
  FOR ALL TO authenticated
  USING (
    (unit_id IS NOT NULL AND unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id))
    OR (unit_id IS NULL AND public.is_admin())
  )
  WITH CHECK (
    (unit_id IS NOT NULL AND unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id))
    OR (unit_id IS NULL AND public.is_admin())
  );


-- ============================================================================
-- 10. APPLICATIONS
-- ============================================================================

DROP POLICY IF EXISTS "Management manage applications" ON public.applications;

CREATE POLICY "applications_scoped_read" ON public.applications
  FOR SELECT TO authenticated
  USING (
    unit_id IN (SELECT public.user_unit_ids())
    OR (unit_id IS NULL AND public.is_admin())
  );

CREATE POLICY "applications_scoped_update" ON public.applications
  FOR UPDATE TO authenticated
  USING (
    (unit_id IS NOT NULL AND unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id))
    OR (unit_id IS NULL AND public.is_admin())
  )
  WITH CHECK (
    (unit_id IS NOT NULL AND unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id))
    OR (unit_id IS NULL AND public.is_admin())
  );

CREATE POLICY "applications_scoped_delete" ON public.applications
  FOR DELETE TO authenticated
  USING (
    (unit_id IS NOT NULL AND unit_id IN (SELECT public.user_unit_ids()) AND public.user_can_manage_unit(unit_id))
    OR (unit_id IS NULL AND public.is_admin())
  );

-- Preserved:
--   "Public can submit applications" (anon + authenticated INSERT — public form)

COMMIT;
