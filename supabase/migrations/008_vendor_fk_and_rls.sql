-- 008: Add FK from work_orders.vendor_id → vendors.id
-- AND restrict vendor portal to only see their own work orders

-- 1. Add foreign key so Supabase PostgREST can resolve the join
--    (vendors:vendor_id(...) requires a FK relationship)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'work_orders_vendor_id_fkey'
      AND table_name = 'work_orders'
  ) THEN
    ALTER TABLE public.work_orders
      ADD CONSTRAINT work_orders_vendor_id_fkey
      FOREIGN KEY (vendor_id) REFERENCES public.vendors(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- 2. Replace the wide-open work_orders SELECT policy with role-aware filtering
--    - Admin / Property Manager / Maintenance: see all work orders
--    - Vendor: see only work orders assigned to them (matched by email)
--    - Tenant: see only their own work orders (matched by tenant_id → leases → user_id)
DROP POLICY IF EXISTS "Authenticated users can read work_orders" ON public.work_orders;

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
    -- Vendors see only their assigned work orders
    vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE v.email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR
    -- Tenants see only their own work orders
    tenant_id IN (
      SELECT t.id FROM public.tenants t
      INNER JOIN public.leases l ON l.tenant_id = t.id
      WHERE l.user_id = auth.uid()
    )
  );
