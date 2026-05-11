-- ============================================================================
-- Migration 071d: Tier 4 RLS Rewrite (via work_order_id)
--
-- Tables (Tier 4 = work-order-scoped child tables):
--   1. work_order_updates    (work_order_id, NOT NULL) — comments/log
--   2. work_order_images     (work_order_id, NOT NULL) — photos
--   3. vendor_bids           (work_order_id + vendor_id, NOT NULL) — bids
--   4. vendor_invoices       (work_order_id + vendor_id, NOT NULL) — invoices
--
-- Strategy: scope via "WO is visible to user" — `work_order_id IN (SELECT id
-- FROM public.work_orders)`. The inner SELECT gets filtered by work_orders' own
-- RLS (rewritten in 071b), which already covers every visibility path:
--   - PM via property_access (Tier 1/2)
--   - Maintenance via assigned_to
--   - Vendor via vendor_id
--   - Tenant via tenant_id
--
-- This means Tier 4 visibility automatically inherits whatever rules apply to
-- the parent WO — no duplication, no possibility of drift.
--
-- Preserved relationship-scoped policies:
--   - Tenant own / Vendor own paths on every table
--   - Tenant/Vendor INSERT policies
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. WORK_ORDER_UPDATES
-- ============================================================================

DROP POLICY IF EXISTS "Staff read work_order_updates"     ON public.work_order_updates;
DROP POLICY IF EXISTS "Staff insert work_order_updates"   ON public.work_order_updates;

CREATE POLICY "wo_updates_scoped_read" ON public.work_order_updates
  FOR SELECT TO authenticated
  USING (work_order_id IN (SELECT id FROM public.work_orders));

-- INSERT: anyone who can see the WO can comment on it.
-- (Tenants/Vendors had their own insert policies preserved; this covers PM/Admin/Maintenance.)
CREATE POLICY "wo_updates_scoped_insert" ON public.work_order_updates
  FOR INSERT TO authenticated
  WITH CHECK (work_order_id IN (SELECT id FROM public.work_orders));

-- UPDATE/DELETE: management of the WO's property only
-- (Use the sub-select pattern; user_can_manage_unit handles the property scope.)
CREATE POLICY "wo_updates_scoped_update" ON public.work_order_updates
  FOR UPDATE TO authenticated
  USING (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.unit_id IS NOT NULL AND public.user_can_manage_unit(wo.unit_id)
    )
  )
  WITH CHECK (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.unit_id IS NOT NULL AND public.user_can_manage_unit(wo.unit_id)
    )
  );

CREATE POLICY "wo_updates_scoped_delete" ON public.work_order_updates
  FOR DELETE TO authenticated
  USING (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.unit_id IS NOT NULL AND public.user_can_manage_unit(wo.unit_id)
    )
  );

-- Preserved (relationship-scoped):
--   "Tenants read own wo_updates", "Vendors read assigned wo_updates", "Vendors insert wo_updates"


-- ============================================================================
-- 2. WORK_ORDER_IMAGES
-- ============================================================================

DROP POLICY IF EXISTS "Staff manage WO images" ON public.work_order_images;

CREATE POLICY "wo_images_scoped_read" ON public.work_order_images
  FOR SELECT TO authenticated
  USING (work_order_id IN (SELECT id FROM public.work_orders));

CREATE POLICY "wo_images_scoped_insert" ON public.work_order_images
  FOR INSERT TO authenticated
  WITH CHECK (work_order_id IN (SELECT id FROM public.work_orders));

CREATE POLICY "wo_images_scoped_write" ON public.work_order_images
  FOR UPDATE TO authenticated
  USING (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.unit_id IS NOT NULL AND public.user_can_manage_unit(wo.unit_id)
    )
  )
  WITH CHECK (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.unit_id IS NOT NULL AND public.user_can_manage_unit(wo.unit_id)
    )
  );

CREATE POLICY "wo_images_scoped_delete" ON public.work_order_images
  FOR DELETE TO authenticated
  USING (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.unit_id IS NOT NULL AND public.user_can_manage_unit(wo.unit_id)
    )
  );

-- Preserved:
--   "Tenants insert own WO images", "Tenants read own WO images"


-- ============================================================================
-- 3. VENDOR_BIDS
-- ============================================================================

DROP POLICY IF EXISTS "Management manage vendor_bids" ON public.vendor_bids;

CREATE POLICY "vendor_bids_scoped_read" ON public.vendor_bids
  FOR SELECT TO authenticated
  USING (work_order_id IN (SELECT id FROM public.work_orders));

-- Mgmt write (UPDATE/DELETE) — only if they can manage the WO's property.
-- Vendors keep their own bid edit policy ("Vendors update own bids").
CREATE POLICY "vendor_bids_scoped_update" ON public.vendor_bids
  FOR UPDATE TO authenticated
  USING (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.unit_id IS NOT NULL AND public.user_can_manage_unit(wo.unit_id)
    )
  )
  WITH CHECK (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.unit_id IS NOT NULL AND public.user_can_manage_unit(wo.unit_id)
    )
  );

CREATE POLICY "vendor_bids_scoped_delete" ON public.vendor_bids
  FOR DELETE TO authenticated
  USING (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.unit_id IS NOT NULL AND public.user_can_manage_unit(wo.unit_id)
    )
  );

-- Preserved:
--   "Vendors insert bids", "Vendors read own bids", "Vendors update own bids"


-- ============================================================================
-- 4. VENDOR_INVOICES
-- ============================================================================

DROP POLICY IF EXISTS "Management manage vendor_invoices" ON public.vendor_invoices;

CREATE POLICY "vendor_invoices_scoped_read" ON public.vendor_invoices
  FOR SELECT TO authenticated
  USING (work_order_id IN (SELECT id FROM public.work_orders));

-- Invoices are financial records — write requires post-financials permission.
CREATE POLICY "vendor_invoices_scoped_update" ON public.vendor_invoices
  FOR UPDATE TO authenticated
  USING (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      JOIN public.units u ON u.id = wo.unit_id
      WHERE public.user_can_post_financials(u.property_id)
    )
  )
  WITH CHECK (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      JOIN public.units u ON u.id = wo.unit_id
      WHERE public.user_can_post_financials(u.property_id)
    )
  );

CREATE POLICY "vendor_invoices_scoped_delete" ON public.vendor_invoices
  FOR DELETE TO authenticated
  USING (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      JOIN public.units u ON u.id = wo.unit_id
      WHERE public.user_can_post_financials(u.property_id)
    )
  );

-- Preserved:
--   "Vendors insert invoices", "Vendors read own invoices"

COMMIT;
