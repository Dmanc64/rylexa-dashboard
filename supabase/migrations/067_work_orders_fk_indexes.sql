-- ============================================================
-- 067_work_orders_fk_indexes.sql
--
-- Add indexes on work_orders FK columns so filtering by vendor,
-- tenant, or unit (for the new admin/maintenance filter toolbar)
-- uses an index scan instead of a full table scan.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_work_orders_vendor_id
  ON public.work_orders(vendor_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_id
  ON public.work_orders(tenant_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_unit_id
  ON public.work_orders(unit_id);
