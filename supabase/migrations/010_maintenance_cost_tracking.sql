-- ============================================================
-- MIGRATION 010: Maintenance Cost Tracking
-- Adds hourly_rate to vendors, cost breakdown columns to work_orders,
-- and updates the update_ticket_status RPC.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ADD hourly_rate TO vendors
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.vendors
  ADD COLUMN IF NOT EXISTS hourly_rate numeric DEFAULT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. ADD cost breakdown columns TO work_orders
--    Existing `cost` column is preserved as the computed total.
-- ────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Hours the vendor worked on this order
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='work_orders' AND column_name='hours_worked') THEN
    ALTER TABLE public.work_orders ADD COLUMN hours_worked numeric DEFAULT 0;
  END IF;

  -- Calculated labor cost (hours_worked * vendor.hourly_rate) — stored for audit
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='work_orders' AND column_name='labor_cost') THEN
    ALTER TABLE public.work_orders ADD COLUMN labor_cost numeric DEFAULT 0;
  END IF;

  -- Invoice override: manual labor amount from vendor invoice (NULL = use calculated)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='work_orders' AND column_name='invoice_amount') THEN
    ALTER TABLE public.work_orders ADD COLUMN invoice_amount numeric DEFAULT NULL;
  END IF;

  -- Materials cost: separate from labor
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='work_orders' AND column_name='materials_cost') THEN
    ALTER TABLE public.work_orders ADD COLUMN materials_cost numeric DEFAULT 0;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. UPDATE update_ticket_status RPC
--    Add optional cost breakdown parameters.
--    Existing callers pass NULL for new params (backward compatible).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_ticket_status(
  ticket_id        uuid,
  new_status       text DEFAULT NULL,
  vendor_name      text DEFAULT NULL,
  repair_cost      numeric DEFAULT NULL,
  manager_notes    text DEFAULT NULL,
  p_hours_worked   numeric DEFAULT NULL,
  p_labor_cost     numeric DEFAULT NULL,
  p_invoice_amount numeric DEFAULT NULL,
  p_materials_cost numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vendor_id uuid;
BEGIN
  -- Resolve vendor by name if provided
  IF vendor_name IS NOT NULL AND vendor_name != '' THEN
    SELECT id INTO v_vendor_id
    FROM public.vendors
    WHERE company_name = vendor_name OR contact_name = vendor_name
    LIMIT 1;
  END IF;

  -- Update the work order
  UPDATE public.work_orders
  SET
    status         = COALESCE(new_status, status),
    vendor_id      = COALESCE(v_vendor_id, vendor_id),
    cost           = COALESCE(repair_cost, cost),
    notes          = COALESCE(manager_notes, notes),
    hours_worked   = COALESCE(p_hours_worked, hours_worked),
    labor_cost     = COALESCE(p_labor_cost, labor_cost),
    invoice_amount = COALESCE(p_invoice_amount, invoice_amount),
    materials_cost = COALESCE(p_materials_cost, materials_cost)
  WHERE id = ticket_id;
END;
$$;
