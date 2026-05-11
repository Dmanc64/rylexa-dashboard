-- 056: RBAC Tightening
-- Items 5 & 6: Tenant work order INSERT validation + vendor status transition guard

BEGIN;

-- ============================================================
-- ITEM 6: Tenant work order INSERT — enforce unit_id matches active lease
-- ============================================================
-- Replace the permissive policy with one that validates unit_id
DROP POLICY IF EXISTS "Tenants insert work_orders" ON public.work_orders;

CREATE POLICY "Tenants insert work_orders"
  ON public.work_orders FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'Tenant'
    AND unit_id IN (
      SELECT l.unit_id FROM public.leases l
      WHERE l.user_id = auth.uid()
        AND l.status = 'Active'
    )
    AND (priority IS NULL OR priority IN ('Low', 'Medium', 'High'))
  );

-- ============================================================
-- VENDOR STATUS TRANSITION GUARD (Item 4)
-- Vendors can only update to allowed statuses
-- ============================================================
-- Drop and recreate vendor update policy with status restrictions
DROP POLICY IF EXISTS "Vendors update assigned work_orders" ON public.work_orders;

CREATE POLICY "Vendors update assigned work_orders"
  ON public.work_orders FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id = (SELECT get_my_vendor_id())
  )
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND vendor_id = (SELECT get_my_vendor_id())
    AND status IN ('Accepted', 'In Progress', 'Completed', 'On Hold')
  );

COMMIT;
