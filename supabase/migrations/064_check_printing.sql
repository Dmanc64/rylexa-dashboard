-- ============================================================================
-- Migration 064: Check Printing (AP)
--
-- Adds:
--   1. bank_accounts           — company bank accounts that bills are paid from
--   2. check_runs              — ledger of printed checks (one row per physical check)
--   3. check_run_bills         — junction (batch pay: one check → many bills)
--   4. next_check_number()     — atomic per-bank-account counter
--   5. record_check_payment()  — transactional "print check": validates bills,
--                                reserves a check #, marks bills paid, increments counter
--   6. void_check_run()        — reverses a printed check; bills return to Approved
--
-- Notes:
--   - Each bank account points to its own GL cash account (so multi-bank shops
--     can cleanly separate Chase Operating vs Wells Trust, etc.).
--   - Check numbers are never re-used. A voided check burns its number.
--   - PDF rendering + upload happens in the generate-check edge function;
--     this migration only handles the data-layer side.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. bank_accounts
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_accounts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 text NOT NULL,             -- display label, e.g. "Chase Operating"
  bank_name            text,                      -- e.g. "JPMorgan Chase"
  routing_number       text NOT NULL CHECK (routing_number ~ '^[0-9]{9}$'),
  account_number       text NOT NULL,
  starting_check_number integer NOT NULL DEFAULT 1001 CHECK (starting_check_number > 0),
  next_check_number    integer NOT NULL DEFAULT 1001 CHECK (next_check_number > 0),
  gl_cash_account_id   uuid REFERENCES public.gl_accounts(id) ON DELETE RESTRICT,
  address_line1        text,
  address_line2        text,
  city                 text,
  state                text,
  postal_code          text,
  fractional_routing   text,                      -- "14-1234/1210" upper-right position on check
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_active ON public.bank_accounts(is_active);

COMMENT ON TABLE public.bank_accounts IS
  'Company bank accounts used to pay vendor bills. Each holds a per-account check-number counter.';
COMMENT ON COLUMN public.bank_accounts.next_check_number IS
  'Next check number to issue. Incremented atomically via next_check_number() RPC.';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_bank_accounts_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bank_accounts_updated_at
  BEFORE UPDATE ON public.bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_bank_accounts_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. check_runs — one row per physical check printed
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.check_runs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_number         integer NOT NULL CHECK (check_number > 0),
  bank_account_id      uuid NOT NULL REFERENCES public.bank_accounts(id) ON DELETE RESTRICT,
  vendor_id            uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  check_date           date NOT NULL DEFAULT CURRENT_DATE,
  total_amount         numeric(12,2) NOT NULL CHECK (total_amount > 0),
  memo                 text,
  pdf_url              text,
  pdf_path             text,                      -- storage path for later re-download
  status               text NOT NULL DEFAULT 'Printed'
    CHECK (status IN ('Printed', 'Voided')),
  printed_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  printed_at           timestamptz NOT NULL DEFAULT now(),
  voided_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  voided_at            timestamptz,
  voided_reason        text,
  created_at           timestamptz NOT NULL DEFAULT now(),

  -- A check number is unique within a bank account.
  CONSTRAINT check_runs_unique_number UNIQUE (bank_account_id, check_number)
);

CREATE INDEX IF NOT EXISTS idx_check_runs_vendor ON public.check_runs(vendor_id);
CREATE INDEX IF NOT EXISTS idx_check_runs_bank ON public.check_runs(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_check_runs_printed_at ON public.check_runs(printed_at DESC);

COMMENT ON TABLE public.check_runs IS
  'Check register — one row per physical check printed, including voided checks (number burned).';

-- ────────────────────────────────────────────────────────────
-- 3. check_run_bills — which bills a check paid (batch-pay many → 1)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.check_run_bills (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_run_id      uuid NOT NULL REFERENCES public.check_runs(id) ON DELETE CASCADE,
  bill_id           uuid NOT NULL REFERENCES public.bills(id) ON DELETE RESTRICT,
  amount_paid       numeric(12,2) NOT NULL CHECK (amount_paid > 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (check_run_id, bill_id)
);

CREATE INDEX IF NOT EXISTS idx_check_run_bills_run ON public.check_run_bills(check_run_id);
CREATE INDEX IF NOT EXISTS idx_check_run_bills_bill ON public.check_run_bills(bill_id);

-- ────────────────────────────────────────────────────────────
-- 4. RLS
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.check_run_bills ENABLE ROW LEVEL SECURITY;

-- Bank accounts: finance roles read; management writes.
CREATE POLICY bank_accounts_finance_read
  ON public.bank_accounts FOR SELECT
  TO authenticated USING (public.is_finance_reader());

CREATE POLICY bank_accounts_management_write
  ON public.bank_accounts FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- Check runs: finance roles read; finance (incl. Accounting) write.
CREATE POLICY check_runs_finance_read
  ON public.check_runs FOR SELECT
  TO authenticated USING (public.is_finance_reader());

CREATE POLICY check_runs_finance_write
  ON public.check_runs FOR INSERT
  TO authenticated WITH CHECK (public.is_finance_reader());

CREATE POLICY check_runs_finance_update
  ON public.check_runs FOR UPDATE
  TO authenticated
  USING (public.is_finance_reader())
  WITH CHECK (public.is_finance_reader());

CREATE POLICY check_run_bills_finance_read
  ON public.check_run_bills FOR SELECT
  TO authenticated USING (public.is_finance_reader());

CREATE POLICY check_run_bills_finance_write
  ON public.check_run_bills FOR INSERT
  TO authenticated WITH CHECK (public.is_finance_reader());

-- ────────────────────────────────────────────────────────────
-- 5. next_check_number() — atomic counter increment
-- ────────────────────────────────────────────────────────────
-- Returns the next check number for the given bank account and increments
-- the counter in the same statement. Uses FOR UPDATE to serialize concurrent
-- callers. Does NOT reserve anything — pair with record_check_payment().
CREATE OR REPLACE FUNCTION public.next_check_number(p_bank_account_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_number integer;
BEGIN
  -- Lock the row so concurrent calls serialize.
  SELECT next_check_number INTO v_number
  FROM public.bank_accounts
  WHERE id = p_bank_account_id
  FOR UPDATE;

  IF v_number IS NULL THEN
    RAISE EXCEPTION 'Bank account not found: %', p_bank_account_id;
  END IF;

  UPDATE public.bank_accounts
  SET next_check_number = v_number + 1
  WHERE id = p_bank_account_id;

  RETURN v_number;
END;
$$;

REVOKE ALL ON FUNCTION public.next_check_number(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.next_check_number(uuid) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 6. record_check_payment() — transactional print
-- ────────────────────────────────────────────────────────────
-- Called by the generate-check edge function AFTER the PDF is built and
-- uploaded. In a single transaction:
--   * Validates every bill is Approved and shares the same vendor
--   * Reserves a check number (increments the bank counter)
--   * Inserts check_runs + check_run_bills rows
--   * Calls mark_bill_paid() for every bill with paid_reference = 'CHK#<n>'
--   * Sets bills.paid_reference and returns { check_run_id, check_number }
CREATE OR REPLACE FUNCTION public.record_check_payment(
  p_bill_ids         uuid[],
  p_bank_account_id  uuid,
  p_memo             text DEFAULT NULL,
  p_check_date       date DEFAULT CURRENT_DATE,
  p_pdf_url          text DEFAULT NULL,
  p_pdf_path         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vendor_id     uuid;
  v_vendor_count  integer;
  v_approved_cnt  integer;
  v_total         numeric(12,2);
  v_check_number  integer;
  v_check_run_id  uuid;
  v_bill          record;
  v_reference     text;
BEGIN
  IF p_bill_ids IS NULL OR array_length(p_bill_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one bill is required';
  END IF;

  -- Validate vendor uniformity + compute total. MIN(uuid) isn't defined in
  -- Postgres so we pick a representative vendor_id separately via LIMIT 1.
  SELECT COUNT(DISTINCT vendor_id), COUNT(*), SUM(amount)
  INTO v_vendor_count, v_approved_cnt, v_total
  FROM public.bills
  WHERE id = ANY(p_bill_ids) AND status = 'Approved';

  IF v_approved_cnt = 0 THEN
    RAISE EXCEPTION 'No approved bills found for the given ids';
  END IF;
  IF v_vendor_count > 1 THEN
    RAISE EXCEPTION 'All bills on a single check must belong to the same vendor';
  END IF;
  IF v_approved_cnt <> array_length(p_bill_ids, 1) THEN
    RAISE EXCEPTION 'One or more bills are not in Approved status';
  END IF;

  SELECT vendor_id INTO v_vendor_id
    FROM public.bills
    WHERE id = ANY(p_bill_ids) AND status = 'Approved'
    LIMIT 1;

  -- Reserve check number.
  v_check_number := public.next_check_number(p_bank_account_id);
  v_reference := 'CHK#' || v_check_number::text;

  -- Insert check run header.
  INSERT INTO public.check_runs (
    check_number, bank_account_id, vendor_id, check_date,
    total_amount, memo, pdf_url, pdf_path, printed_by
  )
  VALUES (
    v_check_number, p_bank_account_id, v_vendor_id, p_check_date,
    v_total, p_memo, p_pdf_url, p_pdf_path, auth.uid()
  )
  RETURNING id INTO v_check_run_id;

  -- For each bill: link + mark paid.
  FOR v_bill IN
    SELECT id, amount FROM public.bills WHERE id = ANY(p_bill_ids)
  LOOP
    INSERT INTO public.check_run_bills (check_run_id, bill_id, amount_paid)
    VALUES (v_check_run_id, v_bill.id, v_bill.amount);

    -- mark_bill_paid posts the AP→Cash ledger entries
    PERFORM public.mark_bill_paid(v_bill.id, v_reference);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'check_run_id', v_check_run_id,
    'check_number', v_check_number,
    'total_amount', v_total,
    'reference', v_reference
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_check_payment(uuid[], uuid, text, date, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.record_check_payment(uuid[], uuid, text, date, text, text) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 7. void_check_run() — undo a printed check
-- ────────────────────────────────────────────────────────────
-- Marks the check as Voided. For each bill: reverses the ledger entries
-- (Credit expense, Debit AP — opposite of mark_bill_paid), and resets the
-- bill to 'Approved' status so the user can re-issue a check if desired.
-- The voided check number is NOT returned to the counter (burned).
CREATE OR REPLACE FUNCTION public.void_check_run(
  p_check_run_id uuid,
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run        record;
  v_bill_row   record;
  v_ap_acct    uuid;
  v_cash_acct  uuid;
  v_je_id      uuid;
  v_desc       text;
BEGIN
  SELECT cr.id, cr.check_number, cr.total_amount, cr.status,
         cr.bank_account_id, ba.gl_cash_account_id
  INTO v_run
  FROM public.check_runs cr
  JOIN public.bank_accounts ba ON ba.id = cr.bank_account_id
  WHERE cr.id = p_check_run_id;

  IF v_run IS NULL THEN
    RAISE EXCEPTION 'Check run not found: %', p_check_run_id;
  END IF;
  IF v_run.status = 'Voided' THEN
    RAISE EXCEPTION 'Check is already voided';
  END IF;

  SELECT id INTO v_ap_acct   FROM public.gl_accounts WHERE code = '2000';
  v_cash_acct := COALESCE(v_run.gl_cash_account_id, (SELECT id FROM public.gl_accounts WHERE code = '1000'));

  -- Reverse ledger for each bill and flip bill back to Approved.
  FOR v_bill_row IN
    SELECT b.id AS bill_id, b.amount, b.description
    FROM public.check_run_bills crb
    JOIN public.bills b ON b.id = crb.bill_id
    WHERE crb.check_run_id = p_check_run_id
  LOOP
    v_desc := 'Void CHK#' || v_run.check_number::text || ': ' || COALESCE(v_bill_row.description, 'Bill');

    INSERT INTO public.journal_entries (description, reference_id, entry_type, created_by)
    VALUES (v_desc, v_bill_row.bill_id, 'AP_VOID', auth.uid())
    RETURNING id INTO v_je_id;

    -- Debit Cash, Credit AP (opposite of mark_bill_paid)
    INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
    VALUES (v_je_id, v_cash_acct, v_bill_row.amount, 0);
    INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
    VALUES (v_je_id, v_ap_acct, 0, v_bill_row.amount);

    UPDATE public.bills
    SET status = 'Approved',
        paid_at = NULL,
        paid_reference = NULL,
        updated_at = now()
    WHERE id = v_bill_row.bill_id;
  END LOOP;

  UPDATE public.check_runs
  SET status = 'Voided',
      voided_at = now(),
      voided_by = auth.uid(),
      voided_reason = p_reason
  WHERE id = p_check_run_id;

  RETURN jsonb_build_object(
    'success', true,
    'check_number', v_run.check_number,
    'total_amount', v_run.total_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.void_check_run(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.void_check_run(uuid, text) TO authenticated;

-- ────────────────────────────────────────────────────────────
-- 8. Feature flag
-- ────────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description)
VALUES ('check_printing', true, 'Check printing for AP payments')
ON CONFLICT (key) DO NOTHING;

COMMIT;
