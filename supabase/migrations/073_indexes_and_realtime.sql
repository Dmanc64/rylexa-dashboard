-- ============================================================================
-- Migration 073: Indexes verification + realtime publication adds
--
-- Two small things:
-- 1. Add composite index on journal_entries(property_id, created_at). The P&L
--    RPC and view filter on both columns; a single composite scan beats
--    bitmap-merging two single-column indexes on 20K+ row queries.
-- 2. Add property_access + owner_entity_members to the supabase_realtime
--    publication so the admin /settings/access page can live-refresh when
--    grants change.
--
-- Other tables (work_orders, notification_queue, etc.) deliberately skipped —
-- realtime adds overhead and these aren't currently subscribed by the UI.
-- ============================================================================

BEGIN;


-- 1. Composite index for P&L hot path
CREATE INDEX IF NOT EXISTS idx_journal_entries_property_created_at
  ON public.journal_entries (property_id, created_at)
  WHERE property_id IS NOT NULL;

COMMENT ON INDEX public.idx_journal_entries_property_created_at IS
  'Hot path for view_profit_and_loss + get_property_pnl_by_period — filters on (property_id, created_at::date BETWEEN ...).';


-- 2. Realtime publication adds
ALTER PUBLICATION supabase_realtime ADD TABLE public.property_access;
ALTER PUBLICATION supabase_realtime ADD TABLE public.owner_entity_members;

COMMIT;
