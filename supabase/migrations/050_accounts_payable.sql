-- ============================================================================
-- Migration 050: Accounts Payable (AP) Module
--
-- Creates:
--   1. bills table — vendor bills with approval workflow
--   2. view_ap_aging — AP aging buckets (current, 1-30, 31-60, 61-90, 90+)
--   3. commit_bill_to_ledger() — posts approved bill to GL
--   4. mark_bill_paid() — clears the AP liability
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. bills table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bills (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  property_id      uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  work_order_id    uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  invoice_number   text,
  description      text NOT NULL,
  amount           numeric(10,2) NOT NULL CHECK (amount > 0),
  due_date         date NOT NULL,
  category         text NOT NULL,
  gl_account_id    uuid REFERENCES public.gl_accounts(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Pending Approval', 'Approved', 'Scheduled', 'Paid', 'Void')),
  file_url         text,
  file_name        text,
  submitted_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at      timestamptz,
  paid_at          timestamptz,
  paid_reference   text,
  notes            text,
  ledger_committed boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bills_vendor_id ON public.bills(vendor_id);
CREATE INDEX IF NOT EXISTS idx_bills_property_id ON public.bills(property_id);
CREATE INDEX IF NOT EXISTS idx_bills_status ON public.bills(status);
CREATE INDEX IF NOT EXISTS idx_bills_due_date ON public.bills(due_date);
CREATE INDEX IF NOT EXISTS idx_bills_work_order_id ON public.bills(work_order_id);

COMMENT ON TABLE public.bills IS 'Accounts payable — vendor bills with approval workflow and GL posting';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_bills_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bills_updated_at
  BEFORE UPDATE ON public.bills
  FOR EACH ROW EXECUTE FUNCTION public.set_bills_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

-- Management full access
CREATE POLICY bills_management_all
  ON public.bills FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- Accounting: read all, update status fields
CREATE POLICY bills_accounting_read
  ON public.bills FOR SELECT
  TO authenticated
  USING (public.is_finance_reader());

CREATE POLICY bills_accounting_update
  ON public.bills FOR UPDATE
  TO authenticated
  USING (
    public.is_finance_reader()
    AND NOT public.is_management()
  )
  WITH CHECK (
    public.is_finance_reader()
    AND NOT public.is_management()
  );

-- Vendors: read own bills (matched by email)
CREATE POLICY bills_vendor_read
  ON public.bills FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = bills.vendor_id
        AND lower(v.email) = lower(
          (SELECT au.email FROM auth.users au WHERE au.id = (SELECT auth.uid()))
        )
    )
  );

-- ────────────────────────────────────────────────────────────
-- 3. view_ap_aging — aging buckets
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.view_ap_aging AS
SELECT
  b.id,
  b.vendor_id,
  v.company_name AS vendor_name,
  v.contact_name AS vendor_contact,
  b.invoice_number,
  b.description,
  b.amount,
  b.due_date,
  b.status,
  b.property_id,
  p.name AS property_name,
  b.category,
  b.created_at,
  CASE
    WHEN b.due_date >= CURRENT_DATE THEN 'current'
    WHEN CURRENT_DATE - b.due_date BETWEEN 1 AND 30 THEN '1_30'
    WHEN CURRENT_DATE - b.due_date BETWEEN 31 AND 60 THEN '31_60'
    WHEN CURRENT_DATE - b.due_date BETWEEN 61 AND 90 THEN '61_90'
    ELSE '90_plus'
  END AS aging_bucket
FROM public.bills b
JOIN public.vendors v ON b.vendor_id = v.id
LEFT JOIN public.properties p ON b.property_id = p.id
WHERE b.status NOT IN ('Paid', 'Void');

-- ────────────────────────────────────────────────────────────
-- 4. commit_bill_to_ledger() — post approved bill to GL
--    Pattern from commit_work_order_expense() in migration 019
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.commit_bill_to_ledger(
  p_bill_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bill          record;
  v_vendor_name   text;
  v_prop_name     text;
  v_description   text;
  v_je_id         uuid;
  v_tx_id         uuid;
  v_expense_acct  uuid;
  v_ap_acct       uuid;
BEGIN
  -- 1. Fetch bill
  SELECT b.id, b.vendor_id, b.property_id, b.amount, b.status,
         b.description, b.invoice_number, b.gl_account_id, b.category,
         b.ledger_committed
  INTO v_bill
  FROM public.bills b
  WHERE b.id = p_bill_id;

  IF v_bill IS NULL THEN
    RAISE EXCEPTION 'Bill not found: %', p_bill_id;
  END IF;

  IF v_bill.ledger_committed THEN
    RAISE EXCEPTION 'Bill already committed to ledger: %', p_bill_id;
  END IF;

  IF v_bill.status NOT IN ('Approved', 'Scheduled', 'Paid') THEN
    RAISE EXCEPTION 'Bill must be Approved/Scheduled/Paid to commit. Current: %', v_bill.status;
  END IF;

  -- 2. Vendor name
  SELECT COALESCE(v.company_name, v.contact_name, 'Unknown Vendor')
  INTO v_vendor_name
  FROM public.vendors v WHERE v.id = v_bill.vendor_id;

  -- 3. Property name
  IF v_bill.property_id IS NOT NULL THEN
    SELECT COALESCE(p.name, 'Unknown') INTO v_prop_name
    FROM public.properties p WHERE p.id = v_bill.property_id;
  ELSE
    v_prop_name := 'General';
  END IF;

  -- 4. Description
  v_description := 'AP: ' || COALESCE(v_bill.description, 'Bill')
    || ' — ' || v_vendor_name
    || ' (' || v_prop_name || ')'
    || CASE WHEN v_bill.invoice_number IS NOT NULL THEN ' #' || v_bill.invoice_number ELSE '' END;

  -- 5. GL accounts
  -- Use specific GL account if set, otherwise default to 5000 (Repairs & Maintenance)
  IF v_bill.gl_account_id IS NOT NULL THEN
    v_expense_acct := v_bill.gl_account_id;
  ELSE
    SELECT id INTO v_expense_acct FROM public.gl_accounts WHERE code = '5000';
  END IF;

  SELECT id INTO v_ap_acct FROM public.gl_accounts WHERE code = '2000'; -- Accounts Payable

  IF v_expense_acct IS NULL OR v_ap_acct IS NULL THEN
    RAISE EXCEPTION 'Required GL accounts not found. Ensure 2000 (AP) and expense account exist.';
  END IF;

  -- 6. Transaction (feeds P&L)
  INSERT INTO public.transactions (type, description, amount, vendor_id, status, date)
  VALUES ('Debit', v_description, v_bill.amount, v_bill.vendor_id, 'Pending', CURRENT_DATE)
  RETURNING id INTO v_tx_id;

  -- 7. Journal entry
  INSERT INTO public.journal_entries (description, reference_id, entry_type, created_by)
  VALUES (v_description, p_bill_id, 'AP_BILL', auth.uid())
  RETURNING id INTO v_je_id;

  -- 8. Ledger entries (double-entry)
  -- Debit: Expense account
  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_expense_acct, v_bill.amount, 0);
  -- Credit: Accounts Payable (liability increases)
  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_ap_acct, 0, v_bill.amount);

  -- 9. Mark committed
  UPDATE public.bills SET ledger_committed = true WHERE id = p_bill_id;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'journal_entry_id', v_je_id,
    'amount', v_bill.amount,
    'description', v_description
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. mark_bill_paid() — clear the AP liability
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mark_bill_paid(
  p_bill_id   uuid,
  p_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bill     record;
  v_je_id    uuid;
  v_ap_acct  uuid;
  v_cash_acct uuid;
  v_desc     text;
BEGIN
  SELECT id, amount, status, ledger_committed, description
  INTO v_bill
  FROM public.bills WHERE id = p_bill_id;

  IF v_bill IS NULL THEN
    RAISE EXCEPTION 'Bill not found: %', p_bill_id;
  END IF;

  IF v_bill.status = 'Paid' THEN
    RAISE EXCEPTION 'Bill is already paid';
  END IF;

  IF v_bill.status NOT IN ('Approved', 'Scheduled') THEN
    RAISE EXCEPTION 'Bill must be Approved or Scheduled to pay. Current: %', v_bill.status;
  END IF;

  -- Ensure bill is committed to ledger first
  IF NOT v_bill.ledger_committed THEN
    PERFORM public.commit_bill_to_ledger(p_bill_id);
  END IF;

  -- Update bill status
  UPDATE public.bills
  SET status = 'Paid',
      paid_at = now(),
      paid_reference = p_reference
  WHERE id = p_bill_id;

  -- GL: Debit AP (liability decreases), Credit Cash (asset decreases)
  SELECT id INTO v_ap_acct FROM public.gl_accounts WHERE code = '2000';
  SELECT id INTO v_cash_acct FROM public.gl_accounts WHERE code = '1000';

  v_desc := 'AP Payment: ' || COALESCE(v_bill.description, 'Bill') ||
    CASE WHEN p_reference IS NOT NULL THEN ' (ref: ' || p_reference || ')' ELSE '' END;

  INSERT INTO public.journal_entries (description, reference_id, entry_type, created_by)
  VALUES (v_desc, p_bill_id, 'AP_PAYMENT', auth.uid())
  RETURNING id INTO v_je_id;

  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_ap_acct, v_bill.amount, 0);

  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_cash_acct, 0, v_bill.amount);

  -- Mark transaction as Cleared
  UPDATE public.transactions
  SET status = 'Cleared'
  WHERE description LIKE '%' || p_bill_id::text || '%'
    OR (reference_id IS NOT NULL AND reference_id = p_bill_id);

  RETURN jsonb_build_object('success', true, 'amount', v_bill.amount);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. Feature flag
-- ────────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description)
VALUES ('accounts_payable', true, 'Accounts payable bill management')
ON CONFLICT (key) DO NOTHING;

COMMIT;
