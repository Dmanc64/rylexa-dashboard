-- 009: Fix vendor RLS email matching to be case-insensitive
-- Auth stores emails lowercase, but vendor table may have mixed case.

DROP POLICY IF EXISTS "Role based read work_orders" ON public.work_orders;

CREATE POLICY "Role based read work_orders"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (
    -- Admin, Property Manager, Maintenance see everything
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('Admin', 'Property Manager', 'Maintenance')
    )
    OR
    -- Vendors see only their assigned work orders (case-insensitive email match)
    vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
    OR
    -- Tenants see only their own work orders
    tenant_id IN (
      SELECT t.id FROM public.tenants t
      INNER JOIN public.leases l ON l.tenant_id = t.id
      WHERE l.user_id = auth.uid()
    )
  );
