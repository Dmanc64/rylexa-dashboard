-- ============================================================================
-- Migration 079: Application Scoring v2
--
-- Adds:
--   1. JSONB columns on applications for per-factor breakdown and blockers
--   2. application_scoring_weights table (single global row, Admin-tunable)
--   3. score_application_v2(uuid) function — computes 0-100 score + breakdown
--      from the v2 application schema. Updates the application row directly.
--
-- Fair Housing notes baked into the function:
--   - No age/DOB scoring beyond 18+ implicit
--   - No scoring on dependents count
--   - additional_income.source is summed but NOT inspected
--   - Felony "yes" produces a flag, never an auto-deny
-- ============================================================================

BEGIN;


-- ─────────────────────────────────────────────────────────────────────────
-- 1. NEW COLUMNS on applications
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS screening_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS screening_blockers  jsonb;


-- ─────────────────────────────────────────────────────────────────────────
-- 2. SCORING WEIGHTS TABLE
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.application_scoring_weights (
  id          int        PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  weights     jsonb      NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid       REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.application_scoring_weights (id, weights)
VALUES (1, jsonb_build_object(
  'income',       30,
  'employment',   15,
  'reserves',     10,
  'residential',  10,
  'debt',         10,
  'flags',        15,
  'completeness',  5,
  'documents',     5
))
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.application_scoring_weights ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "scoring_weights_read" ON public.application_scoring_weights;
CREATE POLICY "scoring_weights_read"
  ON public.application_scoring_weights
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "scoring_weights_admin_write" ON public.application_scoring_weights;
CREATE POLICY "scoring_weights_admin_write"
  ON public.application_scoring_weights
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ─────────────────────────────────────────────────────────────────────────
-- 3. SCORING FUNCTION (see migration applied in Supabase for canonical body)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.score_application_v2(p_app_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app           public.applications;
  v_unit          public.units;
  v_weights       jsonb;
  v_total         numeric := 0;
  v_breakdown     jsonb := '[]'::jsonb;
  v_blockers      jsonb := '[]'::jsonb;
  v_rent          numeric;
  v_w             numeric;
  v_score         numeric;
  v_raw           text;
BEGIN
  SELECT * INTO v_app FROM public.applications WHERE id = p_app_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Application % not found', p_app_id;
  END IF;

  IF v_app.unit_id IS NOT NULL THEN
    SELECT * INTO v_unit FROM public.units WHERE id = v_app.unit_id;
  END IF;

  SELECT weights INTO v_weights FROM public.application_scoring_weights WHERE id = 1;
  IF v_weights IS NULL THEN
    v_weights := jsonb_build_object(
      'income', 30, 'employment', 15, 'reserves', 10, 'residential', 10,
      'debt', 10, 'flags', 15, 'completeness', 5, 'documents', 5
    );
  END IF;

  v_rent := COALESCE(v_unit.market_rent, 0);

  -- Income ratio
  DECLARE
    v_primary    numeric := COALESCE(v_app.monthly_salary, v_app.income, 0);
    v_addl       numeric;
    v_coapp      numeric;
    v_income     numeric;
    v_ratio      numeric;
  BEGIN
    SELECT COALESCE(SUM(monthly_amount), 0) INTO v_addl
    FROM public.application_additional_income
    WHERE application_id = p_app_id;

    SELECT COALESCE(SUM(monthly_salary), 0) INTO v_coapp
    FROM public.application_coapplicants
    WHERE application_id = p_app_id
      AND submitted_at IS NOT NULL;

    v_income := v_primary + v_addl + v_coapp;
    v_w := (v_weights->>'income')::numeric;

    IF v_rent > 0 AND v_income > 0 THEN
      v_ratio := v_income / v_rent;
      v_score := LEAST(1.0, GREATEST(0.0, (v_ratio - 1.0) / 2.0)) * v_w;
      v_raw   := format('$%s / $%s = %sx',
                        to_char(v_income, 'FM999G999G990'),
                        to_char(v_rent, 'FM999G999G990'),
                        to_char(v_ratio, 'FM990.99'));

      IF v_ratio < 1.5 THEN
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'kind', 'low_income',
          'message', format('Income $%s is only %sx the $%s rent (target ≥3x).',
                            to_char(v_income, 'FM999G999G990'),
                            to_char(v_ratio, 'FM990.99'),
                            to_char(v_rent, 'FM999G999G990'))
        ));
      END IF;
    ELSE
      v_score := 0;
      v_raw   := CASE WHEN v_rent = 0 THEN 'No unit selected' ELSE 'No income reported' END;
    END IF;

    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'name', 'Income ratio', 'key', 'income',
      'weight', v_w, 'raw', v_raw, 'score', ROUND(v_score, 1)
    ));
    v_total := v_total + v_score;
  END;

  -- Employment tenure
  DECLARE
    v_years numeric := COALESCE(v_app.years_worked, 0);
  BEGIN
    v_w := (v_weights->>'employment')::numeric;
    v_score := LEAST(1.0, v_years / 5.0) * v_w;
    v_raw   := format('%s yrs at current employer', to_char(v_years, 'FM990.9'));
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'name', 'Employment tenure', 'key', 'employment',
      'weight', v_w, 'raw', v_raw, 'score', ROUND(v_score, 1)
    ));
    v_total := v_total + v_score;
  END;

  -- Cash reserves
  DECLARE
    v_reserves numeric;
    v_months   numeric;
  BEGIN
    SELECT COALESCE(SUM(balance), 0) INTO v_reserves
    FROM public.application_bank_accounts
    WHERE application_id = p_app_id;

    v_w := (v_weights->>'reserves')::numeric;
    IF v_rent > 0 THEN
      v_months := v_reserves / v_rent;
      v_score  := LEAST(1.0, v_months / 3.0) * v_w;
      v_raw    := format('$%s in bank = %s months rent',
                         to_char(v_reserves, 'FM999G999G990'),
                         to_char(v_months, 'FM990.9'));
    ELSE
      v_score := 0;
      v_raw   := 'No rent set';
    END IF;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'name', 'Cash reserves', 'key', 'reserves',
      'weight', v_w, 'raw', v_raw, 'score', ROUND(v_score, 1)
    ));
    v_total := v_total + v_score;
  END;

  -- Residential stability
  DECLARE
    v_yrs_at_current numeric := 0;
    v_current_count  int     := 0;
    v_from_date      date;
  BEGIN
    SELECT resided_from INTO v_from_date
    FROM public.application_addresses
    WHERE application_id = p_app_id AND kind = 'current'
    ORDER BY sort_order LIMIT 1;

    SELECT count(*) INTO v_current_count
    FROM public.application_addresses
    WHERE application_id = p_app_id AND kind = 'current';

    v_w := (v_weights->>'residential')::numeric;
    IF v_from_date IS NOT NULL THEN
      v_yrs_at_current := EXTRACT(EPOCH FROM (now() - v_from_date::timestamptz)) / 31557600;
      v_score := LEAST(1.0, v_yrs_at_current / 2.0) * v_w;
      v_raw   := format('%s yrs at current address', to_char(v_yrs_at_current, 'FM990.9'));
    ELSIF v_current_count > 0 THEN
      v_score := 0.5 * v_w;
      v_raw   := 'Current address listed but no move-in date';
    ELSE
      v_score := 0;
      v_raw   := 'No current address listed';
    END IF;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'name', 'Residential stability', 'key', 'residential',
      'weight', v_w, 'raw', v_raw, 'score', ROUND(v_score, 1)
    ));
    v_total := v_total + v_score;
  END;

  -- Debt load
  DECLARE
    v_debt    numeric;
    v_income2 numeric := COALESCE(v_app.monthly_salary, v_app.income, 0);
    v_ratio   numeric;
  BEGIN
    SELECT COALESCE(SUM(balance), 0) INTO v_debt
    FROM public.application_credit_cards
    WHERE application_id = p_app_id;

    v_w := (v_weights->>'debt')::numeric;
    IF v_income2 > 0 AND v_debt > 0 THEN
      v_ratio := v_debt / v_income2;
      v_score := GREATEST(0.0, 1.0 - v_ratio) * v_w;
      v_raw   := format('$%s cards / $%s income = %s%%',
                        to_char(v_debt, 'FM999G999G990'),
                        to_char(v_income2, 'FM999G999G990'),
                        to_char(v_ratio * 100, 'FM990'));
    ELSIF v_debt = 0 THEN
      v_score := v_w;
      v_raw   := 'No credit card debt reported';
    ELSE
      v_score := 0;
      v_raw   := 'No income reported';
    END IF;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'name', 'Debt load', 'key', 'debt',
      'weight', v_w, 'raw', v_raw, 'score', ROUND(v_score, 1)
    ));
    v_total := v_total + v_score;
  END;

  -- Screening flags
  DECLARE
    v_flags        int := 0;
    v_answered     int := 0;
    v_flag_list    text[] := ARRAY[]::text[];
  BEGIN
    IF v_app.q_delinquent_payment IS NOT NULL THEN v_answered := v_answered + 1; END IF;
    IF v_app.q_felony_conviction  IS NOT NULL THEN v_answered := v_answered + 1; END IF;
    IF v_app.q_sued_landlord      IS NOT NULL THEN v_answered := v_answered + 1; END IF;
    IF v_app.q_water_filled_furniture IS NOT NULL THEN v_answered := v_answered + 1; END IF;
    IF v_app.q_smoker             IS NOT NULL THEN v_answered := v_answered + 1; END IF;

    IF v_app.q_delinquent_payment IS TRUE THEN
      v_flags := v_flags + 1; v_flag_list := array_append(v_flag_list, 'rent delinquency');
    END IF;
    IF v_app.q_felony_conviction IS TRUE THEN
      v_flags := v_flags + 1; v_flag_list := array_append(v_flag_list, 'felony');
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'kind', 'felony',
        'message', 'Applicant disclosed a felony conviction. Per FHA guidance, consider nature, time elapsed, and rehabilitation. Approval/denial requires a documented reason.'
      ));
    END IF;
    IF v_app.q_sued_landlord IS TRUE THEN
      v_flags := v_flags + 1; v_flag_list := array_append(v_flag_list, 'sued by landlord');
    END IF;
    IF v_app.q_water_filled_furniture IS TRUE THEN
      v_flags := v_flags + 1; v_flag_list := array_append(v_flag_list, 'water-filled furniture');
    END IF;
    IF v_app.q_smoker IS TRUE THEN
      v_flags := v_flags + 1; v_flag_list := array_append(v_flag_list, 'smoker');
    END IF;

    v_w := (v_weights->>'flags')::numeric;
    IF v_answered = 0 THEN
      v_score := 0;
      v_raw   := 'No screening questions answered';
    ELSE
      v_score := GREATEST(0.0, (v_answered::numeric - v_flags) / 5.0) * v_w;
      v_raw   := CASE
        WHEN v_flags = 0 THEN format('All clear (%s/5 answered)', v_answered)
        ELSE format('%s flag(s): %s', v_flags, array_to_string(v_flag_list, ', '))
      END;
    END IF;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'name', 'Screening flags', 'key', 'flags',
      'weight', v_w, 'raw', v_raw, 'score', ROUND(v_score, 1)
    ));
    v_total := v_total + v_score;
  END;

  -- Completeness
  DECLARE
    v_filled int := 0;
    v_total_fields constant int := 12;
  BEGIN
    IF v_app.salutation             IS NOT NULL THEN v_filled := v_filled + 1; END IF;
    IF v_app.middle_name            IS NOT NULL OR v_app.no_middle_name_certified IS TRUE THEN v_filled := v_filled + 1; END IF;
    IF v_app.date_of_birth          IS NOT NULL THEN v_filled := v_filled + 1; END IF;
    IF v_app.ssn_last_4             IS NOT NULL THEN v_filled := v_filled + 1; END IF;
    IF v_app.gov_id_issuing_state   IS NOT NULL THEN v_filled := v_filled + 1; END IF;
    IF v_app.employer               IS NOT NULL THEN v_filled := v_filled + 1; END IF;
    IF v_app.supervisor_name        IS NOT NULL THEN v_filled := v_filled + 1; END IF;
    IF v_app.position_held          IS NOT NULL THEN v_filled := v_filled + 1; END IF;
    IF EXISTS (SELECT 1 FROM public.application_phones WHERE application_id = p_app_id) THEN v_filled := v_filled + 1; END IF;
    IF EXISTS (SELECT 1 FROM public.application_addresses WHERE application_id = p_app_id AND kind = 'current') THEN v_filled := v_filled + 1; END IF;
    IF EXISTS (SELECT 1 FROM public.application_emergency_contacts WHERE application_id = p_app_id) THEN v_filled := v_filled + 1; END IF;
    IF EXISTS (SELECT 1 FROM public.application_bank_accounts WHERE application_id = p_app_id) THEN v_filled := v_filled + 1; END IF;

    v_w := (v_weights->>'completeness')::numeric;
    v_score := (v_filled::numeric / v_total_fields) * v_w;
    v_raw   := format('%s of %s optional fields populated', v_filled, v_total_fields);
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'name', 'Completeness', 'key', 'completeness',
      'weight', v_w, 'raw', v_raw, 'score', ROUND(v_score, 1)
    ));
    v_total := v_total + v_score;
  END;

  -- Documents
  DECLARE
    v_doc_count int;
  BEGIN
    SELECT count(*) INTO v_doc_count
    FROM public.application_attachments
    WHERE application_id = p_app_id;

    v_w := (v_weights->>'documents')::numeric;
    IF v_doc_count >= 1 THEN
      v_score := v_w;
      v_raw   := format('%s file(s) attached', v_doc_count);
    ELSE
      v_score := 0;
      v_raw   := 'No documents uploaded';
    END IF;
    v_breakdown := v_breakdown || jsonb_build_array(jsonb_build_object(
      'name', 'Documents', 'key', 'documents',
      'weight', v_w, 'raw', v_raw, 'score', ROUND(v_score, 1)
    ));
    v_total := v_total + v_score;
  END;

  -- Data-integrity blockers
  IF v_app.first_name IS NULL OR v_app.last_name IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'kind', 'incomplete', 'message', 'Applicant name is missing.'
    ));
  END IF;
  IF v_app.unit_id IS NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'kind', 'incomplete', 'message', 'No unit selected on the application.'
    ));
  END IF;
  IF v_app.q_sued_landlord IS TRUE
     AND NOT EXISTS (
       SELECT 1 FROM public.application_addresses
       WHERE application_id = p_app_id AND kind = 'previous'
     )
  THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'kind', 'sued_no_history',
      'message', 'Applicant indicated a prior lawsuit by a landlord but listed no previous addresses to verify against.'
    ));
  END IF;

  UPDATE public.applications
  SET screening_score      = ROUND(v_total),
      screening_breakdown  = v_breakdown,
      screening_blockers   = v_blockers,
      screening_status     = 'Screened',
      screened_at          = now()
  WHERE id = p_app_id;

  RETURN jsonb_build_object(
    'total_score',  ROUND(v_total),
    'breakdown',    v_breakdown,
    'blockers',     v_blockers,
    'scored_at',    now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.score_application_v2(uuid) TO authenticated;


COMMIT;
