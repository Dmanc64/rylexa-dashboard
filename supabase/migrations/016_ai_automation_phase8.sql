-- Migration 016: AI & Automation (Phase 8)
-- Feature flags, maintenance triage, lease renewal scoring, transaction categorization
-- Rollback: DROP TABLE feature_flags, lease_renewal_scores; DROP columns added here; DROP functions added here.

BEGIN;

-- ============================================================
-- 1. FEATURE FLAGS
-- ============================================================

CREATE TABLE IF NOT EXISTS feature_flags (
  key   TEXT PRIMARY KEY,
  value BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default flags (all OFF by default)
INSERT INTO feature_flags (key, value, description) VALUES
  ('ai_maintenance_triage',       false, 'Auto-classify priority & category on new work orders'),
  ('ai_lease_renewal_scoring',    false, 'Score lease renewal likelihood for expiring leases'),
  ('ai_transaction_categorization', false, 'AI-assisted transaction matching and categorization')
ON CONFLICT (key) DO NOTHING;

-- RLS: staff can read, only admins can toggle
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "feature_flags_read_staff" ON feature_flags
  FOR SELECT USING (
    (SELECT is_staff())
  );

CREATE POLICY "feature_flags_write_admin" ON feature_flags
  FOR UPDATE USING (
    (SELECT is_admin())
  )
  WITH CHECK (
    (SELECT is_admin())
  );

-- ============================================================
-- 2. MAINTENANCE TRIAGE — new columns on work_orders
-- ============================================================

-- Category classification
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS category TEXT;

-- AI-suggested priority (separate from human-set priority)
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS ai_priority TEXT;

-- Confidence score (0-100)
ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS ai_confidence INTEGER;

-- CHECK constraints
ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_category_check
    CHECK (category IS NULL OR category IN (
      'Plumbing', 'Electrical', 'HVAC', 'Appliance',
      'Structural', 'Pest Control', 'Landscaping',
      'General Maintenance', 'Safety', 'Other'
    ));

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_ai_priority_check
    CHECK (ai_priority IS NULL OR ai_priority IN ('Low', 'Normal', 'Medium', 'High', 'Emergency'));

ALTER TABLE work_orders
  ADD CONSTRAINT work_orders_ai_confidence_check
    CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 100));

-- Index for filtering by category
CREATE INDEX IF NOT EXISTS idx_work_orders_category ON work_orders (category) WHERE category IS NOT NULL;

-- ============================================================
-- 3. LEASE RENEWAL SCORING
-- ============================================================

CREATE TABLE IF NOT EXISTS lease_renewal_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id        UUID NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  risk_level      TEXT NOT NULL CHECK (risk_level IN ('Low', 'Medium', 'High')),
  factors         JSONB NOT NULL DEFAULT '{}',
  scored_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lease_id)  -- one score per lease, upsert pattern
);

ALTER TABLE lease_renewal_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "renewal_scores_read_management" ON lease_renewal_scores
  FOR SELECT USING (
    (SELECT is_management())
  );

CREATE INDEX IF NOT EXISTS idx_renewal_scores_lease ON lease_renewal_scores (lease_id);
CREATE INDEX IF NOT EXISTS idx_renewal_scores_risk ON lease_renewal_scores (risk_level);

-- RPC: score_lease_renewals()
-- Rules-based scoring engine (no external API needed):
--   • Tenure length (longer = higher score)
--   • Days until expiry (imminent = lower score → higher risk)
--   • Payment track record (ratio of Paid vs total transactions)
--   • Rent amount relative to property average
-- Returns count of scored leases
CREATE OR REPLACE FUNCTION score_lease_renewals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER := 0;
  rec     RECORD;
  v_score INTEGER;
  v_factors JSONB;
  v_tenure_months NUMERIC;
  v_days_to_expiry INTEGER;
  v_payment_ratio NUMERIC;
  v_rent_vs_avg NUMERIC;
  v_avg_rent NUMERIC;
  v_total_txn INTEGER;
  v_paid_txn INTEGER;
BEGIN
  -- Check feature flag
  IF NOT EXISTS (
    SELECT 1 FROM public.feature_flags WHERE key = 'ai_lease_renewal_scoring' AND value = true
  ) THEN
    RAISE EXCEPTION 'Feature ai_lease_renewal_scoring is disabled';
  END IF;

  FOR rec IN
    SELECT l.id AS lease_id, l.start_date, l.end_date, l.rent_amount,
           l.tenant_id, u.property_id
    FROM public.leases l
    JOIN public.units u ON u.id = l.unit_id
    WHERE l.status = 'Active'
      AND l.end_date IS NOT NULL
      AND l.end_date <= (CURRENT_DATE + INTERVAL '90 days')
  LOOP
    -- Factor 1: Tenure (months since start)
    v_tenure_months := EXTRACT(EPOCH FROM (CURRENT_DATE - rec.start_date)) / 2592000.0;

    -- Factor 2: Days to expiry
    v_days_to_expiry := rec.end_date - CURRENT_DATE;

    -- Factor 3: Payment track record
    SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'Paid')
    INTO v_total_txn, v_paid_txn
    FROM public.transactions
    WHERE lease_id = rec.lease_id;

    v_payment_ratio := CASE WHEN v_total_txn > 0 THEN v_paid_txn::NUMERIC / v_total_txn ELSE 0.5 END;

    -- Factor 4: Rent vs property average
    SELECT COALESCE(AVG(l2.rent_amount), rec.rent_amount)
    INTO v_avg_rent
    FROM public.leases l2
    JOIN public.units u2 ON u2.id = l2.unit_id
    WHERE u2.property_id = rec.property_id AND l2.status = 'Active';

    v_rent_vs_avg := CASE WHEN v_avg_rent > 0 THEN rec.rent_amount / v_avg_rent ELSE 1.0 END;

    -- Compute composite score (0-100, higher = more likely to renew)
    v_score := LEAST(100, GREATEST(0,
      (
        -- Tenure: up to 30 pts (capped at 24 months)
        LEAST(30, (v_tenure_months / 24.0) * 30)
        -- Time pressure: up to 20 pts (more days = higher score)
        + LEAST(20, (GREATEST(0, v_days_to_expiry)::NUMERIC / 90.0) * 20)
        -- Payment history: up to 35 pts
        + (v_payment_ratio * 35)
        -- Rent competitiveness: up to 15 pts (lower rent vs avg = more likely to stay)
        + CASE WHEN v_rent_vs_avg <= 1.0 THEN 15
               WHEN v_rent_vs_avg <= 1.15 THEN 10
               WHEN v_rent_vs_avg <= 1.3 THEN 5
               ELSE 0 END
      )::INTEGER
    ));

    v_factors := jsonb_build_object(
      'tenure_months', round(v_tenure_months, 1),
      'days_to_expiry', v_days_to_expiry,
      'payment_ratio', round(v_payment_ratio, 2),
      'total_transactions', v_total_txn,
      'paid_transactions', v_paid_txn,
      'rent_amount', rec.rent_amount,
      'avg_property_rent', round(v_avg_rent, 2),
      'rent_vs_avg_ratio', round(v_rent_vs_avg, 2)
    );

    -- Upsert
    INSERT INTO public.lease_renewal_scores (lease_id, score, risk_level, factors, scored_at)
    VALUES (
      rec.lease_id,
      v_score,
      CASE WHEN v_score >= 70 THEN 'Low'
           WHEN v_score >= 40 THEN 'Medium'
           ELSE 'High' END,
      v_factors,
      now()
    )
    ON CONFLICT (lease_id) DO UPDATE SET
      score      = EXCLUDED.score,
      risk_level = EXCLUDED.risk_level,
      factors    = EXCLUDED.factors,
      scored_at  = EXCLUDED.scored_at;

    v_count := v_count + 1;
  END LOOP;

  -- Log activity
  INSERT INTO public.system_activity (event_type, title, description, actor_name)
  VALUES ('AI_SCORING', 'Lease Renewal Scoring', 'Scored ' || v_count || ' leases expiring within 90 days.', 'System AI');

  RETURN v_count;
END;
$$;

-- ============================================================
-- 4. TRANSACTION CATEGORIZATION — new columns on transactions
-- ============================================================

-- AI-suggested category (separate from human-set category)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS ai_category TEXT;

-- AI confidence score (0-100)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS ai_confidence INTEGER;

-- AI-suggested lease match (separate from lease_id FK which is the confirmed match)
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS ai_match_lease_id UUID REFERENCES leases(id) ON DELETE SET NULL;

-- AI-suggested vendor match
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS ai_match_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

ALTER TABLE transactions
  ADD CONSTRAINT transactions_ai_confidence_check
    CHECK (ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 100));

CREATE INDEX IF NOT EXISTS idx_transactions_ai_confidence ON transactions (ai_confidence) WHERE ai_confidence IS NOT NULL;

-- ============================================================
-- 5. TRIAGE RPC — rules-based maintenance categorization
-- ============================================================

-- triage_work_order(p_work_order_id UUID)
-- Classifies category and priority from title + description using keyword rules.
-- No external API call — runs entirely in Postgres.
CREATE OR REPLACE FUNCTION triage_work_order(p_work_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title       TEXT;
  v_description TEXT;
  v_combined    TEXT;
  v_category    TEXT := 'General Maintenance';
  v_priority    TEXT := 'Normal';
  v_confidence  INTEGER := 60;
BEGIN
  -- Check feature flag
  IF NOT EXISTS (
    SELECT 1 FROM public.feature_flags WHERE key = 'ai_maintenance_triage' AND value = true
  ) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'Feature disabled');
  END IF;

  SELECT title, COALESCE(description, '') INTO v_title, v_description
  FROM public.work_orders WHERE id = p_work_order_id;

  IF v_title IS NULL THEN
    RAISE EXCEPTION 'Work order not found: %', p_work_order_id;
  END IF;

  v_combined := lower(v_title || ' ' || v_description);

  -- Category classification (ordered by specificity)
  IF v_combined ~ '(fire|smoke|carbon monoxide|gas leak|flood|sewage)' THEN
    v_category := 'Safety'; v_priority := 'Emergency'; v_confidence := 95;
  ELSIF v_combined ~ '(leak|pipe|drain|faucet|toilet|sink|water heater|plumb|clog|sewer)' THEN
    v_category := 'Plumbing'; v_confidence := 88;
    IF v_combined ~ '(flood|burst|sewage|no water)' THEN v_priority := 'High'; END IF;
  ELSIF v_combined ~ '(outlet|switch|breaker|wire|electrical|power|light|circuit|spark)' THEN
    v_category := 'Electrical'; v_confidence := 85;
    IF v_combined ~ '(spark|no power|shock|exposed wire)' THEN v_priority := 'High'; END IF;
  ELSIF v_combined ~ '(ac|a/c|heat|hvac|furnace|thermostat|air condition|warm air|cold air|no heat|no cool)' THEN
    v_category := 'HVAC'; v_confidence := 87;
    IF v_combined ~ '(no heat|no cool|no ac|no a/c)' THEN v_priority := 'High'; END IF;
  ELSIF v_combined ~ '(refrigerator|fridge|stove|oven|dishwasher|washer|dryer|microwave|garbage disposal|appliance)' THEN
    v_category := 'Appliance'; v_confidence := 82;
  ELSIF v_combined ~ '(door|window|wall|ceiling|floor|roof|crack|hole|foundation|struct)' THEN
    v_category := 'Structural'; v_confidence := 80;
  ELSIF v_combined ~ '(pest|roach|mouse|mice|rat|ant|bug|termite|bee|wasp|rodent|insect)' THEN
    v_category := 'Pest Control'; v_confidence := 90;
  ELSIF v_combined ~ '(lawn|tree|shrub|garden|landscape|fence|gate|parking lot|snow|ice|gutter)' THEN
    v_category := 'Landscaping'; v_confidence := 78;
  END IF;

  -- Update the work order
  UPDATE public.work_orders
  SET category      = v_category,
      ai_priority   = v_priority,
      ai_confidence = v_confidence
  WHERE id = p_work_order_id;

  RETURN jsonb_build_object(
    'category', v_category,
    'ai_priority', v_priority,
    'ai_confidence', v_confidence
  );
END;
$$;

-- ============================================================
-- 6. TRANSACTION MATCHING RPC — rules-based categorization
-- ============================================================

-- categorize_transaction(p_transaction_id UUID)
-- Attempts to match a transaction to a lease or vendor based on description + amount patterns.
CREATE OR REPLACE FUNCTION categorize_transaction(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_txn         RECORD;
  v_category    TEXT;
  v_confidence  INTEGER := 0;
  v_match_lease UUID;
  v_match_vendor UUID;
  v_desc        TEXT;
BEGIN
  -- Check feature flag
  IF NOT EXISTS (
    SELECT 1 FROM public.feature_flags WHERE key = 'ai_transaction_categorization' AND value = true
  ) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'Feature disabled');
  END IF;

  SELECT * INTO v_txn FROM public.transactions WHERE id = p_transaction_id;
  IF v_txn IS NULL THEN
    RAISE EXCEPTION 'Transaction not found: %', p_transaction_id;
  END IF;

  v_desc := lower(COALESCE(v_txn.description, ''));

  -- If already has a confirmed lease_id, use that
  IF v_txn.lease_id IS NOT NULL THEN
    v_category := COALESCE(v_txn.category, 'Rent');
    v_confidence := 95;
    v_match_lease := v_txn.lease_id;
  -- If already has a confirmed vendor_id, use that
  ELSIF v_txn.vendor_id IS NOT NULL THEN
    v_category := 'Vendor Payment';
    v_confidence := 90;
    v_match_vendor := v_txn.vendor_id;
  ELSE
    -- Try to match by description keywords
    IF v_desc ~ '(rent|monthly payment|lease payment)' THEN
      v_category := 'Rent';
      -- Try to find a matching lease by amount
      SELECT l.id INTO v_match_lease
      FROM public.leases l
      WHERE l.status = 'Active' AND l.rent_amount = v_txn.amount
      LIMIT 1;
      v_confidence := CASE WHEN v_match_lease IS NOT NULL THEN 82 ELSE 55 END;

    ELSIF v_desc ~ '(deposit|security deposit|move.in)' THEN
      v_category := 'Security Deposit';
      v_confidence := 75;

    ELSIF v_desc ~ '(repair|maintenance|fix|service|plumb|electric|hvac)' THEN
      v_category := 'Maintenance';
      -- Try to match vendor by amount to recent work orders
      SELECT wo.vendor_id INTO v_match_vendor
      FROM public.work_orders wo
      WHERE wo.cost = v_txn.amount AND wo.vendor_id IS NOT NULL
        AND wo.created_at >= (v_txn.created_at - INTERVAL '60 days')
      ORDER BY wo.created_at DESC
      LIMIT 1;
      v_confidence := CASE WHEN v_match_vendor IS NOT NULL THEN 78 ELSE 50 END;

    ELSIF v_desc ~ '(insurance|policy|premium)' THEN
      v_category := 'Insurance'; v_confidence := 70;

    ELSIF v_desc ~ '(utility|water|electric|gas|sewer|trash)' THEN
      v_category := 'Utilities'; v_confidence := 72;

    ELSIF v_desc ~ '(tax|property tax|assessment)' THEN
      v_category := 'Taxes'; v_confidence := 68;

    ELSIF v_desc ~ '(mortgage|loan|principal|interest)' THEN
      v_category := 'Mortgage'; v_confidence := 65;

    ELSIF v_desc ~ '(late fee|penalty|charge)' THEN
      v_category := 'Late Fee'; v_confidence := 80;

    ELSE
      v_category := 'Uncategorized'; v_confidence := 30;
    END IF;
  END IF;

  -- Update the transaction
  UPDATE public.transactions
  SET ai_category        = v_category,
      ai_confidence      = v_confidence,
      ai_match_lease_id  = v_match_lease,
      ai_match_vendor_id = v_match_vendor
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object(
    'ai_category', v_category,
    'ai_confidence', v_confidence,
    'ai_match_lease_id', v_match_lease,
    'ai_match_vendor_id', v_match_vendor
  );
END;
$$;

-- Batch categorize all pending transactions
CREATE OR REPLACE FUNCTION categorize_pending_transactions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count INTEGER := 0;
  v_id    UUID;
BEGIN
  FOR v_id IN
    SELECT id FROM public.transactions
    WHERE ai_confidence IS NULL AND status = 'Pending'
    ORDER BY created_at DESC
    LIMIT 100
  LOOP
    PERFORM public.categorize_transaction(v_id);
    v_count := v_count + 1;
  END LOOP;

  INSERT INTO public.system_activity (event_type, title, description, actor_name)
  VALUES ('AI_CATEGORIZATION', 'Transaction Categorization', 'Categorized ' || v_count || ' pending transactions.', 'System AI');

  RETURN v_count;
END;
$$;

COMMIT;
