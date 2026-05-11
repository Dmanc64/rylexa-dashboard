-- ============================================================================
-- Migration 071g: Views Audit — set security_invoker on every view
--
-- A view without `security_invoker = on` runs queries as the view's OWNER
-- (here, `postgres`, which has BYPASSRLS). That means the view returns all
-- rows regardless of who's querying — bypassing every property/lease/unit
-- RLS policy we set up in 071a–071e.
--
-- Audit found 17 views correctly set, 2 not:
--   * view_profit_and_loss   — off (default)  ← critical: financial data leak
--   * available_units        — false (explicit)
--
-- Fixing both. Idempotent: setting security_invoker = on on a view where
-- it's already on is a no-op.
-- ============================================================================

BEGIN;

ALTER VIEW public.view_profit_and_loss SET (security_invoker = on);
ALTER VIEW public.available_units      SET (security_invoker = on);

COMMIT;
