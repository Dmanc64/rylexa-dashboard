-- ============================================================
-- 068_ai_suggested_vendor_id.sql
--
-- Adds the missing ai_suggested_vendor_id column on work_orders.
-- The triage-work-order edge function has been writing to this
-- column since phase 8 of AI automation, but no migration ever
-- created it — so the UPDATE silently dropped the field and the
-- suggestion never persisted past the function's response.
-- ============================================================

ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS ai_suggested_vendor_id uuid
    REFERENCES public.vendors(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.work_orders.ai_suggested_vendor_id IS
  'Set by the triage-work-order edge function after classifying the ticket. The AssignVendorModal surfaces this as a pinned recommendation so a PM can one-click assign without re-searching.';

-- Partial index — we only care about rows that actually have a suggestion.
CREATE INDEX IF NOT EXISTS idx_work_orders_ai_suggested_vendor_id
  ON public.work_orders(ai_suggested_vendor_id)
  WHERE ai_suggested_vendor_id IS NOT NULL;
