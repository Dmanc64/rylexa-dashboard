-- ============================================================================
-- Migration 032: Billing Engine
--
-- Creates the infrastructure for automated billing:
-- 1. billing_settings table (configurable per-property or global defaults)
-- 2. billing_runs table (audit log of each billing execution)
-- 3. Update accounting type constraint to include 'Utility Charge'
-- 4. Seed GL account 4200 (Utility Income) if missing
-- 5. get_billing_settings() RPC
-- 6. calculate_late_fee_amount() RPC
-- 7. post_monthly_utilities() RPC (mirrors post_monthly_rent pattern)
-- 8. fn_auto_ledger_utility_charge() trigger function + trigger
-- 9. RLS policies on new tables
-- 10. Indexes
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: billing_settings table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.billing_settings (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id         uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  rent_due_day        integer NOT NULL DEFAULT 1,
  grace_period_days   integer NOT NULL DEFAULT 5,
  late_fee_type       text NOT NULL DEFAULT 'flat'
                      CHECK (late_fee_type IN ('flat', 'percent')),
  late_fee_amount     numeric NOT NULL DEFAULT 50.00,
  auto_post_rent      boolean NOT NULL DEFAULT true,
  auto_post_utilities boolean NOT NULL DEFAULT false,
  auto_late_fees      boolean NOT NULL DEFAULT true,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),
  CONSTRAINT billing_settings_property_unique UNIQUE (property_id)
);

INSERT INTO public.billing_settings (property_id, rent_due_day, grace_period_days, late_fee_type, late_fee_amount)
VALUES (NULL, 1, 5, 'flat', 50.00)
ON CONFLICT ON CONSTRAINT billing_settings_property_unique DO NOTHING;


-- ============================================================================
-- STEP 2: billing_runs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.billing_runs (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  run_date              date NOT NULL DEFAULT CURRENT_DATE,
  run_type              text NOT NULL
                        CHECK (run_type IN ('rent', 'utility', 'late_fee', 'full')),
  triggered_by          uuid REFERENCES auth.users(id),
  rent_charges_count    integer NOT NULL DEFAULT 0,
  utility_charges_count integer NOT NULL DEFAULT 0,
  late_fees_count       integer NOT NULL DEFAULT 0,
  status                text NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'completed', 'failed')),
  error_details         text,
  created_at            timestamptz DEFAULT now()
);


-- ============================================================================
-- STEP 3: Update accounting type constraint
-- ============================================================================

ALTER TABLE public.accounting DROP CONSTRAINT IF EXISTS accounting_type_check;
ALTER TABLE public.accounting ADD CONSTRAINT accounting_type_check
  CHECK (type IN ('Income', 'Expense', 'Rent Charge', 'Payment', 'Late Fee', 'Credit', 'Utility Charge'));


-- ============================================================================
-- STEP 4: Seed GL account 4200 (Utility Income) if missing
-- ============================================================================

INSERT INTO public.gl_accounts (code, name, account_type)
SELECT '4200', 'Utility Income', 'Revenue'
WHERE NOT EXISTS (
  SELECT 1 FROM public.gl_accounts WHERE code = '4200'
);


-- ============================================================================
-- STEP 5: get_billing_settings(p_property_id uuid)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_billing_settings(p_property_id uuid DEFAULT NULL)
RETURNS TABLE (
  rent_due_day        integer,
  grace_period_days   integer,
  late_fee_type       text,
  late_fee_amount     numeric,
  auto_post_rent      boolean,
  auto_post_utilities boolean,
  auto_late_fees      boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bs.rent_due_day,
    bs.grace_period_days,
    bs.late_fee_type,
    bs.late_fee_amount,
    bs.auto_post_rent,
    bs.auto_post_utilities,
    bs.auto_late_fees
  FROM public.billing_settings bs
  WHERE bs.property_id IS NOT DISTINCT FROM p_property_id
  LIMIT 1;

  IF NOT FOUND AND p_property_id IS NOT NULL THEN
    RETURN QUERY
    SELECT
      bs.rent_due_day,
      bs.grace_period_days,
      bs.late_fee_type,
      bs.late_fee_amount,
      bs.auto_post_rent,
      bs.auto_post_utilities,
      bs.auto_late_fees
    FROM public.billing_settings bs
    WHERE bs.property_id IS NULL
    LIMIT 1;
  END IF;
END;
$$;


-- ============================================================================
-- STEP 6: calculate_late_fee_amount(p_balance, p_property_id)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_late_fee_amount(
  p_balance numeric,
  p_property_id uuid DEFAULT NULL
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_fee_type text;
  v_fee_amount numeric;
  v_result numeric;
BEGIN
  SELECT bs.late_fee_type, bs.late_fee_amount
  INTO v_fee_type, v_fee_amount
  FROM public.get_billing_settings(p_property_id) bs;

  IF v_fee_type = 'percent' THEN
    v_result := ROUND(p_balance * (v_fee_amount / 100.0), 2);
  ELSE
    v_result := v_fee_amount;
  END IF;

  RETURN GREATEST(v_result, 0);
END;
$$;


-- ============================================================================
-- STEP 7: post_monthly_utilities(target_date date)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_monthly_utilities(target_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
  v_month_start date;
  v_month_end date;
  r RECORD;
BEGIN
  v_month_start := date_trunc('month', target_date)::date;
  v_month_end   := (date_trunc('month', target_date) + interval '1 month' - interval '1 day')::date;

  FOR r IN
    SELECT l.id AS lease_id, l.utility_fee, l.user_id
    FROM public.leases l
    WHERE l.status = 'Active'
      AND l.utility_fee > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.accounting a
        WHERE a.lease_id = l.id
          AND a.created_at >= v_month_start
          AND a.created_at < v_month_end + interval '1 day'
          AND a.type = 'Utility Charge'
      )
  LOOP
    INSERT INTO public.accounting (lease_id, user_id, type, category, amount, description, status, created_at)
    VALUES (
      r.lease_id,
      r.user_id,
      'Utility Charge',
      'Utility Charge',
      r.utility_fee,
      'Monthly utility charge for ' || to_char(target_date, 'Month YYYY'),
      'Posted',
      target_date
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


-- ============================================================================
-- STEP 8: fn_auto_ledger_utility_charge() trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_auto_ledger_utility_charge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_journal_id UUID;
  v_ar_account_id UUID;
  v_utility_income_id UUID;
BEGIN
  SELECT id INTO v_ar_account_id FROM public.gl_accounts WHERE code = '1100';
  SELECT id INTO v_utility_income_id FROM public.gl_accounts WHERE code = '4200';

  IF v_ar_account_id IS NULL OR v_utility_income_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.journal_entries (description, reference_id, entry_type)
  VALUES (
    'Monthly Utility Charge - ' || COALESCE(NEW.description, to_char(NEW.created_at, 'Month YYYY')),
    NEW.lease_id,
    'Utility_Charge'
  ) RETURNING id INTO v_journal_id;

  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_journal_id, v_ar_account_id, NEW.amount, 0);

  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_journal_id, v_utility_income_id, 0, NEW.amount);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_ledger_utility_charge ON public.accounting;
CREATE TRIGGER trg_auto_ledger_utility_charge
  AFTER INSERT ON public.accounting
  FOR EACH ROW
  WHEN (NEW.type = 'Utility Charge')
  EXECUTE FUNCTION public.fn_auto_ledger_utility_charge();


-- ============================================================================
-- STEP 9: RLS policies
-- ============================================================================

ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_settings_management_all
  ON public.billing_settings
  FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY billing_settings_finance_read
  ON public.billing_settings
  FOR SELECT
  TO authenticated
  USING (public.is_finance_reader());

ALTER TABLE public.billing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY billing_runs_management_all
  ON public.billing_runs
  FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY billing_runs_finance_read
  ON public.billing_runs
  FOR SELECT
  TO authenticated
  USING (public.is_finance_reader());


-- ============================================================================
-- STEP 10: Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_billing_settings_property_id
  ON public.billing_settings(property_id);

CREATE INDEX IF NOT EXISTS idx_billing_runs_run_date
  ON public.billing_runs(run_date);

CREATE INDEX IF NOT EXISTS idx_billing_runs_status
  ON public.billing_runs(status);

CREATE INDEX IF NOT EXISTS idx_accounting_type_lease_created
  ON public.accounting(type, lease_id, created_at);

COMMIT;
