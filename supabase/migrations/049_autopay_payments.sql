-- ============================================================================
-- Migration 049: Autopay & Payment Processing
--
-- Creates infrastructure for:
--   1. Payment records (one-time and autopay)
--   2. Saved Stripe payment methods per tenant
--   3. Autopay settings per lease
--   4. record_payment() RPC for posting to accounting + GL
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. payments table — records every rent payment
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id                 uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  tenant_id                uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  amount                   numeric(10,2) NOT NULL CHECK (amount > 0),
  stripe_payment_intent_id text,
  stripe_payment_method_id text,
  card_brand               text,
  card_last4               text,
  status                   text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'refunded')),
  is_autopay               boolean NOT NULL DEFAULT false,
  failure_reason           text,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_lease_id ON public.payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON public.payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at DESC);

COMMENT ON TABLE public.payments IS 'Records every rent payment (one-time or autopay) with Stripe tracking';

-- ────────────────────────────────────────────────────────────
-- 2. tenant_payment_methods — saved Stripe cards
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_payment_methods (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id                   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id        text NOT NULL,
  stripe_payment_method_id  text NOT NULL,
  card_brand                text,
  card_last4                text,
  exp_month                 integer,
  exp_year                  integer,
  is_default                boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tpm_tenant_id ON public.tenant_payment_methods(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tpm_user_id ON public.tenant_payment_methods(user_id);

COMMENT ON TABLE public.tenant_payment_methods IS 'Saved Stripe payment methods for tenant autopay';

-- ────────────────────────────────────────────────────────────
-- 3. autopay_settings — recurring payment config per lease
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.autopay_settings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id          uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  payment_method_id uuid NOT NULL REFERENCES public.tenant_payment_methods(id) ON DELETE CASCADE,
  amount_type       text NOT NULL DEFAULT 'balance'
    CHECK (amount_type IN ('fixed', 'balance')),
  fixed_amount      numeric(10,2),
  max_amount        numeric(10,2),
  day_of_month      integer NOT NULL DEFAULT 1
    CHECK (day_of_month >= 1 AND day_of_month <= 28),
  is_active         boolean NOT NULL DEFAULT true,
  next_run_date     date,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopay_one_per_lease UNIQUE (lease_id)
);

CREATE INDEX IF NOT EXISTS idx_autopay_active ON public.autopay_settings(is_active, next_run_date)
  WHERE is_active = true;

COMMENT ON TABLE public.autopay_settings IS 'Per-lease autopay configuration for recurring rent payments';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_autopay_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_autopay_settings_updated_at
  BEFORE UPDATE ON public.autopay_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_autopay_settings_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. RLS policies
-- ────────────────────────────────────────────────────────────

-- payments
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_management_all
  ON public.payments FOR ALL
  TO authenticated
  USING (public.is_finance_reader())
  WITH CHECK (public.is_management());

CREATE POLICY payments_tenant_read
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = payments.lease_id
        AND l.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY payments_tenant_insert
  ON public.payments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = payments.lease_id
        AND l.user_id = (SELECT auth.uid())
    )
  );

-- tenant_payment_methods
ALTER TABLE public.tenant_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY tpm_management_read
  ON public.tenant_payment_methods FOR SELECT
  TO authenticated
  USING (public.is_management());

CREATE POLICY tpm_tenant_all
  ON public.tenant_payment_methods FOR ALL
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- autopay_settings
ALTER TABLE public.autopay_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY autopay_management_read
  ON public.autopay_settings FOR SELECT
  TO authenticated
  USING (public.is_management());

CREATE POLICY autopay_tenant_all
  ON public.autopay_settings FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = autopay_settings.lease_id
        AND l.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leases l
      WHERE l.id = autopay_settings.lease_id
        AND l.user_id = (SELECT auth.uid())
    )
  );

-- ────────────────────────────────────────────────────────────
-- 5. record_payment() RPC
--    Posts payment to: payments, accounting, journal, ledger
--    Pattern from commit_work_order_expense() in migration 019
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.record_payment(
  p_lease_id        uuid,
  p_amount          numeric,
  p_stripe_pi_id    text DEFAULT NULL,
  p_stripe_pm_id    text DEFAULT NULL,
  p_card_brand      text DEFAULT NULL,
  p_card_last4      text DEFAULT NULL,
  p_is_autopay      boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease        record;
  v_tenant_name  text;
  v_prop_name    text;
  v_description  text;
  v_payment_id   uuid;
  v_je_id        uuid;
  v_cash_acct    uuid;
  v_ar_acct      uuid;
BEGIN
  -- 1. Fetch lease with tenant
  SELECT l.id, l.tenant_id, l.unit_id, l.user_id,
         t.first_name, t.last_name
  INTO v_lease
  FROM public.leases l
  JOIN public.tenants t ON l.tenant_id = t.id
  WHERE l.id = p_lease_id;

  IF v_lease IS NULL THEN
    RAISE EXCEPTION 'Lease not found: %', p_lease_id;
  END IF;

  v_tenant_name := COALESCE(v_lease.first_name, '') || ' ' || COALESCE(v_lease.last_name, '');

  -- 2. Get property name
  IF v_lease.unit_id IS NOT NULL THEN
    SELECT COALESCE(p.name, 'Unknown')
    INTO v_prop_name
    FROM public.units u
    JOIN public.properties p ON u.property_id = p.id
    WHERE u.id = v_lease.unit_id;
  ELSE
    v_prop_name := 'Unknown';
  END IF;

  v_description := 'Rent Payment — ' || TRIM(v_tenant_name) || ' (' || v_prop_name || ')';

  -- 3. Insert into payments table
  INSERT INTO public.payments (
    lease_id, tenant_id, amount,
    stripe_payment_intent_id, stripe_payment_method_id,
    card_brand, card_last4, status, is_autopay
  ) VALUES (
    p_lease_id, v_lease.tenant_id, p_amount,
    p_stripe_pi_id, p_stripe_pm_id,
    p_card_brand, p_card_last4, 'succeeded', p_is_autopay
  )
  RETURNING id INTO v_payment_id;

  -- 4. Insert into accounting (type = 'Payment')
  INSERT INTO public.accounting (
    lease_id, type, category, amount, description, status, date
  ) VALUES (
    p_lease_id, 'Payment', 'Rent Payment', p_amount,
    v_description, 'Cleared', CURRENT_DATE
  );

  -- 5. GL posting: Debit Cash (1000), Credit AR (1100)
  SELECT id INTO v_cash_acct FROM public.gl_accounts WHERE code = '1000';
  SELECT id INTO v_ar_acct   FROM public.gl_accounts WHERE code = '1100';

  IF v_cash_acct IS NOT NULL AND v_ar_acct IS NOT NULL THEN
    INSERT INTO public.journal_entries (description, reference_id, entry_type, created_by)
    VALUES (v_description, p_lease_id, 'RENT_PAYMENT', auth.uid())
    RETURNING id INTO v_je_id;

    -- Debit Cash (asset increases)
    INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
    VALUES (v_je_id, v_cash_acct, p_amount, 0);

    -- Credit AR (asset decreases)
    INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
    VALUES (v_je_id, v_ar_acct, 0, p_amount);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'amount', p_amount,
    'description', v_description
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 6. Feature flag
-- ────────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description)
VALUES ('autopay', true, 'Saved cards and recurring rent payments')
ON CONFLICT (key) DO NOTHING;

COMMIT;
