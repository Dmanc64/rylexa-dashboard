-- ============================================================================
-- Migration 019: Work Order Expense → Ledger Commit
--
-- Bridges the gap between work_orders.cost and the financial ledger.
-- When a work order is completed with a cost, Admin/Accounting can
-- "Commit to Ledger" which writes to all 3 accounting layers:
--   1. transactions (Debit) — feeds P&L view
--   2. journal_entries — audit trail
--   3. ledger_entries — double-entry GL (Debit 5000, Credit 1000)
--
-- Follows the exact pattern of post_late_fee() from migration 015.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. Add work_order_id FK to transactions
--    Links expenses back to their source work order
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS work_order_id uuid REFERENCES public.work_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_work_order_id
  ON public.transactions (work_order_id);

-- ────────────────────────────────────────────────────────────
-- 2. Add ledger_committed flag to work_orders
--    Prevents double-posting of the same expense
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS ledger_committed boolean DEFAULT false;

-- ────────────────────────────────────────────────────────────
-- 3. Create commit_work_order_expense() RPC
--    Mirrors post_late_fee() pattern from migration 015
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.commit_work_order_expense(
  p_work_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_wo           record;
  v_vendor_name  text;
  v_prop_name    text;
  v_description  text;
  v_je_id        uuid;
  v_tx_id        uuid;
  v_expense_acct uuid;
  v_cash_acct    uuid;
BEGIN
  -- 1. Fetch work order with validation
  SELECT w.id, w.title, w.cost, w.status, w.vendor_id, w.unit_id, w.ledger_committed
  INTO v_wo
  FROM public.work_orders w
  WHERE w.id = p_work_order_id;

  IF v_wo IS NULL THEN
    RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
  END IF;

  IF v_wo.ledger_committed THEN
    RAISE EXCEPTION 'Expense already committed to ledger for work order: %', p_work_order_id;
  END IF;

  IF v_wo.cost IS NULL OR v_wo.cost <= 0 THEN
    RAISE EXCEPTION 'Work order has no cost to commit: %', p_work_order_id;
  END IF;

  IF v_wo.status NOT IN ('Completed', 'Closed', 'Done') THEN
    RAISE EXCEPTION 'Work order must be Completed/Closed/Done to commit. Current status: %', v_wo.status;
  END IF;

  -- 2. Look up vendor name (for description)
  IF v_wo.vendor_id IS NOT NULL THEN
    SELECT COALESCE(v.company_name, v.contact_name, 'Unknown Vendor')
    INTO v_vendor_name
    FROM public.vendors v
    WHERE v.id = v_wo.vendor_id;
  ELSE
    v_vendor_name := 'No Vendor';
  END IF;

  -- 3. Look up property name (for description)
  IF v_wo.unit_id IS NOT NULL THEN
    SELECT COALESCE(p.name, 'Unknown Property')
    INTO v_prop_name
    FROM public.units u
    JOIN public.properties p ON u.property_id = p.id
    WHERE u.id = v_wo.unit_id;
  ELSE
    v_prop_name := 'Unknown Property';
  END IF;

  -- 4. Build description
  v_description := 'Maintenance: ' || COALESCE(v_wo.title, 'Work Order') || ' — ' || v_vendor_name || ' (' || v_prop_name || ')';

  -- 5. Look up GL account IDs
  SELECT id INTO v_expense_acct FROM public.gl_accounts WHERE code = '5000'; -- Repairs & Maintenance
  SELECT id INTO v_cash_acct    FROM public.gl_accounts WHERE code = '1000'; -- Cash / Operating

  IF v_expense_acct IS NULL OR v_cash_acct IS NULL THEN
    RAISE EXCEPTION 'Required GL accounts (5000, 1000) not found. Please seed gl_accounts.';
  END IF;

  -- 6. INSERT into transactions (feeds P&L view via type = 'Debit')
  INSERT INTO public.transactions (type, description, amount, vendor_id, work_order_id, status, date)
  VALUES ('Debit', v_description, v_wo.cost, v_wo.vendor_id, p_work_order_id, 'Cleared', CURRENT_DATE)
  RETURNING id INTO v_tx_id;

  -- 7. INSERT journal entry (audit trail)
  INSERT INTO public.journal_entries (description, reference_id, entry_type, created_by)
  VALUES (v_description, p_work_order_id, 'MAINTENANCE_EXPENSE', auth.uid())
  RETURNING id INTO v_je_id;

  -- 8. INSERT ledger entries (double-entry)
  -- Debit: Repairs & Maintenance (expense increases)
  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_expense_acct, v_wo.cost, 0);

  -- Credit: Cash / Operating Account (asset decreases)
  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_cash_acct, 0, v_wo.cost);

  -- 9. Mark work order as committed (prevents double-posting)
  UPDATE public.work_orders
  SET ledger_committed = true
  WHERE id = p_work_order_id;

  -- 10. Return summary
  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'journal_entry_id', v_je_id,
    'amount', v_wo.cost,
    'description', v_description
  );
END;
$$;

COMMIT;
