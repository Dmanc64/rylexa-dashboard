-- ============================================================
-- 034_tenant_screening.sql
-- Adds screening/scoring columns to applications, a scoring
-- RPC, an index, and a feature flag.
-- ============================================================

-- ── 1A. Add screening columns to applications ──────────────
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS months_at_address integer,
  ADD COLUMN IF NOT EXISTS previous_landlord_name text,
  ADD COLUMN IF NOT EXISTS previous_landlord_phone text,
  ADD COLUMN IF NOT EXISTS months_at_employer integer,
  ADD COLUMN IF NOT EXISTS additional_income numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS num_occupants integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS credit_score integer,
  ADD COLUMN IF NOT EXISTS background_clear boolean,
  ADD COLUMN IF NOT EXISTS eviction_history boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bankruptcy_history boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS screening_score integer,
  ADD COLUMN IF NOT EXISTS screening_status text DEFAULT 'Unscreened',
  ADD COLUMN IF NOT EXISTS screening_notes text,
  ADD COLUMN IF NOT EXISTS screened_at timestamptz,
  ADD COLUMN IF NOT EXISTS screened_by uuid REFERENCES public.profiles(id);

-- Add CHECK constraint for screening_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'applications_screening_status_check'
  ) THEN
    ALTER TABLE public.applications
      ADD CONSTRAINT applications_screening_status_check
      CHECK (screening_status IS NULL OR screening_status IN ('Unscreened','Screened','Waived'));
  END IF;
END $$;

-- ── 1B. score_application() RPC ────────────────────────────
CREATE OR REPLACE FUNCTION public.score_application(p_application_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app          record;
  v_market_rent  numeric;
  v_total_income numeric;
  v_ratio        numeric;
  v_score_income integer := 0;
  v_score_credit integer := 0;
  v_score_employ integer := 0;
  v_score_reside integer := 0;
  v_score_flags  integer := 10;
  v_total_score  integer;
  v_caller_role  text;
BEGIN
  -- Verify caller is management
  SELECT role INTO v_caller_role
  FROM public.profiles
  WHERE id = (SELECT auth.uid());

  IF v_caller_role IS NULL OR v_caller_role NOT IN ('Admin', 'Property Manager') THEN
    RAISE EXCEPTION 'Only management can score applications';
  END IF;

  -- Fetch application
  SELECT a.*, u.market_rent
  INTO v_app
  FROM public.applications a
  LEFT JOIN public.units u ON u.id = a.unit_id
  WHERE a.id = p_application_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application not found';
  END IF;

  IF v_app.status != 'Pending' THEN
    RAISE EXCEPTION 'Only Pending applications can be scored';
  END IF;

  -- ── Category 1: Income Ratio (30 pts) ──
  v_market_rent := COALESCE(v_app.market_rent, 0);
  v_total_income := COALESCE(v_app.income, 0) + COALESCE(v_app.additional_income, 0);

  IF v_market_rent > 0 THEN
    v_ratio := v_total_income / v_market_rent;
    IF v_ratio >= 3.0 THEN v_score_income := 30;
    ELSIF v_ratio >= 2.5 THEN v_score_income := 24;
    ELSIF v_ratio >= 2.0 THEN v_score_income := 18;
    ELSIF v_ratio >= 1.5 THEN v_score_income := 10;
    ELSE v_score_income := 0;
    END IF;
  ELSE
    -- No market rent data — give neutral score
    v_score_income := 15;
  END IF;

  -- ── Category 2: Credit Score (25 pts) ──
  IF v_app.credit_score IS NULL THEN
    v_score_credit := 10; -- neutral when not provided
  ELSIF v_app.credit_score >= 750 THEN v_score_credit := 25;
  ELSIF v_app.credit_score >= 700 THEN v_score_credit := 20;
  ELSIF v_app.credit_score >= 650 THEN v_score_credit := 15;
  ELSIF v_app.credit_score >= 600 THEN v_score_credit := 8;
  ELSE v_score_credit := 0;
  END IF;

  -- ── Category 3: Employment Stability (20 pts) ──
  IF v_app.months_at_employer IS NULL THEN
    v_score_employ := 8; -- neutral
  ELSIF v_app.months_at_employer >= 24 THEN v_score_employ := 20;
  ELSIF v_app.months_at_employer >= 12 THEN v_score_employ := 15;
  ELSIF v_app.months_at_employer >= 6 THEN v_score_employ := 10;
  ELSE v_score_employ := 3;
  END IF;

  -- ── Category 4: Residence Stability (15 pts) ──
  IF v_app.months_at_address IS NULL THEN
    v_score_reside := 6; -- neutral
  ELSIF v_app.months_at_address >= 24 THEN v_score_reside := 15;
  ELSIF v_app.months_at_address >= 12 THEN v_score_reside := 11;
  ELSIF v_app.months_at_address >= 6 THEN v_score_reside := 7;
  ELSE v_score_reside := 2;
  END IF;

  -- ── Category 5: Risk Flags (10 pts) ──
  v_score_flags := 10;
  IF COALESCE(v_app.eviction_history, false) THEN
    v_score_flags := v_score_flags - 10;
  END IF;
  IF COALESCE(v_app.bankruptcy_history, false) THEN
    v_score_flags := v_score_flags - 5;
  END IF;
  IF v_app.background_clear IS NOT NULL AND NOT v_app.background_clear THEN
    v_score_flags := v_score_flags - 10;
  END IF;
  IF v_score_flags < 0 THEN v_score_flags := 0; END IF;

  -- ── Total ──
  v_total_score := v_score_income + v_score_credit + v_score_employ + v_score_reside + v_score_flags;

  -- Persist score
  UPDATE public.applications SET
    screening_score  = v_total_score,
    screening_status = 'Screened',
    screened_at      = now(),
    screened_by      = (SELECT auth.uid())
  WHERE id = p_application_id;

  RETURN v_total_score;
END;
$$;

-- ── 1C. Index ──────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_applications_screening
  ON public.applications(screening_status, status);

-- ── 1D. Feature flag ───────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('tenant_screening', true, 'Enable tenant screening scores and approval gates')
ON CONFLICT (key) DO NOTHING;
