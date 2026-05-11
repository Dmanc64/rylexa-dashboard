-- ============================================================================
-- Migration 071h: Property-scoped RLS on journal_entries / ledger_entries
--
-- After 071g landed (security_invoker on view_profit_and_loss), the view
-- correctly defers to the caller's RLS. But the underlying journal_entries /
-- ledger_entries tables only allowed Management/Accounting global reads, so:
--   * Owners (and PMs/Accounting users we narrowed) get $0 in the view —
--     the GL data is blocked at the join.
--   * Conversely, PMs/Accounting saw every property's GL because the old
--     policies didn't check property scope.
--
-- This migration scopes those tables to property_access / owner_entity_members
-- like every other property-scoped table.
--
-- Also opens gl_accounts (chart of accounts) to all authenticated readers —
-- it's reference data, not sensitive.
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. JOURNAL_ENTRIES — property-scoped read
-- ============================================================================

DROP POLICY IF EXISTS "Management read journal_entries"  ON public.journal_entries;
DROP POLICY IF EXISTS "Accounting read journal_entries"  ON public.journal_entries;

CREATE POLICY "journal_entries_scoped_read" ON public.journal_entries
  FOR SELECT TO authenticated
  USING (
    property_id IN (SELECT public.user_property_ids())
    OR (property_id IS NULL AND public.is_admin())
  );

-- Existing INSERT policy "Management insert journal_entries" stays — but it's
-- broad (any PM can insert anywhere). Tightening that too:

DROP POLICY IF EXISTS "Management insert journal_entries" ON public.journal_entries;

CREATE POLICY "journal_entries_scoped_insert" ON public.journal_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (property_id IS NOT NULL AND public.user_can_post_financials(property_id))
  );


-- ============================================================================
-- 2. LEDGER_ENTRIES — scope via journal_entry_id (inherits journal RLS)
-- ============================================================================

DROP POLICY IF EXISTS "Management read ledger_entries"  ON public.ledger_entries;
DROP POLICY IF EXISTS "Accounting read ledger_entries"  ON public.ledger_entries;
DROP POLICY IF EXISTS "Management insert ledger_entries" ON public.ledger_entries;

CREATE POLICY "ledger_entries_scoped_read" ON public.ledger_entries
  FOR SELECT TO authenticated
  USING (journal_entry_id IN (SELECT id FROM public.journal_entries));

CREATE POLICY "ledger_entries_scoped_insert" ON public.ledger_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    journal_entry_id IN (
      SELECT je.id FROM public.journal_entries je
      WHERE public.is_admin()
        OR (je.property_id IS NOT NULL AND public.user_can_post_financials(je.property_id))
    )
  );


-- ============================================================================
-- 3. GL_ACCOUNTS — open read to all authenticated users (chart of accounts)
-- ============================================================================

DROP POLICY IF EXISTS "Management read gl_accounts" ON public.gl_accounts;
DROP POLICY IF EXISTS "Accounting read gl_accounts" ON public.gl_accounts;

CREATE POLICY "gl_accounts_read_all" ON public.gl_accounts
  FOR SELECT TO authenticated
  USING (true);

-- (Writes are still admin-only via existing policies — no change there.)

COMMIT;
