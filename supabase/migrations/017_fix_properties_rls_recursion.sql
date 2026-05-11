-- Migration 017: Fix infinite recursion in properties RLS policies
--
-- The "Tenants read own property" and "Vendors read assigned properties" policies
-- contained subqueries that re-joined the properties table, triggering RLS evaluation
-- recursively. Fix: subqueries now only touch units + leases/work_orders.
--
-- Rollback: Restore original policies from migration 015.

BEGIN;

-- Fix: "Tenants read own property" — remove self-referencing properties join
DROP POLICY IF EXISTS "Tenants read own property" ON properties;
CREATE POLICY "Tenants read own property" ON properties
  FOR SELECT USING (
    (SELECT get_my_role()) = 'Tenant'
    AND id IN (
      SELECT u.property_id
      FROM units u
      JOIN leases l ON l.unit_id = u.id
      WHERE l.user_id = (SELECT auth.uid())
        AND l.status = 'Active'
    )
  );

-- Fix: "Vendors read assigned properties" — remove self-referencing properties join
DROP POLICY IF EXISTS "Vendors read assigned properties" ON properties;
CREATE POLICY "Vendors read assigned properties" ON properties
  FOR SELECT USING (
    (SELECT get_my_role()) = 'Vendor'
    AND id IN (
      SELECT u.property_id
      FROM units u
      JOIN work_orders wo ON wo.unit_id = u.id
      WHERE wo.vendor_id = (SELECT get_my_vendor_id())
    )
  );

COMMIT;
