-- ============================================================================
-- Migration 051: Leasing CRM / Lead Management Pipeline
--
-- Creates:
--   1. leads table — prospect tracking with pipeline stages
--   2. lead_activities — interaction log
--   3. tours — scheduled property tours
--   4. view_lead_pipeline — stage counts
--   5. advance_lead_stage() RPC
--   6. Anonymous INSERT policy for public lead capture
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. leads table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.leads (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name            text NOT NULL,
  last_name             text NOT NULL,
  email                 text NOT NULL,
  phone                 text,
  source                text NOT NULL DEFAULT 'website'
    CHECK (source IN ('website', 'zillow', 'apartments_com', 'realtor_com', 'craigslist', 'facebook', 'referral', 'walk_in', 'phone', 'other')),
  source_listing_id     uuid REFERENCES public.unit_listings(id) ON DELETE SET NULL,
  interested_unit_id    uuid REFERENCES public.units(id) ON DELETE SET NULL,
  interested_property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  stage                 text NOT NULL DEFAULT 'New'
    CHECK (stage IN ('New', 'Contacted', 'Tour Scheduled', 'Tour Completed', 'Applied', 'Leased', 'Lost')),
  assigned_to           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  desired_move_in       date,
  desired_bedrooms      integer,
  budget_max            numeric(10,2),
  notes                 text,
  application_id        uuid REFERENCES public.applications(id) ON DELETE SET NULL,
  lost_reason           text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leads_stage ON public.leads(stage);
CREATE INDEX IF NOT EXISTS idx_leads_source ON public.leads(source);
CREATE INDEX IF NOT EXISTS idx_leads_email ON public.leads(email);
CREATE INDEX IF NOT EXISTS idx_leads_property ON public.leads(interested_property_id);
CREATE INDEX IF NOT EXISTS idx_leads_assigned_to ON public.leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_created_at ON public.leads(created_at DESC);

COMMENT ON TABLE public.leads IS 'Prospect/lead tracking for leasing CRM pipeline';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_leads_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.set_leads_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. lead_activities table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lead_activities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id        uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  activity_type  text NOT NULL
    CHECK (activity_type IN ('note', 'email_sent', 'phone_call', 'text_sent', 'tour_scheduled', 'tour_completed', 'application_received', 'stage_change')),
  description    text NOT NULL,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON public.lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_activities_created_at ON public.lead_activities(created_at DESC);

-- ────────────────────────────────────────────────────────────
-- 3. tours table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tours (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id          uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  property_id      uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_id          uuid REFERENCES public.units(id) ON DELETE SET NULL,
  scheduled_at     timestamptz NOT NULL,
  duration_minutes integer NOT NULL DEFAULT 30,
  status           text NOT NULL DEFAULT 'Scheduled'
    CHECK (status IN ('Scheduled', 'Completed', 'Cancelled', 'No Show')),
  notes            text,
  conducted_by     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tours_lead_id ON public.tours(lead_id);
CREATE INDEX IF NOT EXISTS idx_tours_property_id ON public.tours(property_id);
CREATE INDEX IF NOT EXISTS idx_tours_scheduled_at ON public.tours(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tours_status ON public.tours(status);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_tours_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tours_updated_at
  BEFORE UPDATE ON public.tours
  FOR EACH ROW EXECUTE FUNCTION public.set_tours_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. RLS policies
-- ────────────────────────────────────────────────────────────

-- leads
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY leads_management_all
  ON public.leads FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- Anonymous INSERT for public lead capture
CREATE POLICY leads_anon_insert
  ON public.leads FOR INSERT
  TO anon
  WITH CHECK (true);

-- lead_activities
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_activities_management_all
  ON public.lead_activities FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- tours
ALTER TABLE public.tours ENABLE ROW LEVEL SECURITY;

CREATE POLICY tours_management_all
  ON public.tours FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- ────────────────────────────────────────────────────────────
-- 5. view_lead_pipeline
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.view_lead_pipeline AS
SELECT
  stage,
  COUNT(*) AS count,
  COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)) AS this_month,
  COUNT(*) FILTER (WHERE created_at >= date_trunc('week', CURRENT_DATE)) AS this_week
FROM public.leads
GROUP BY stage
ORDER BY CASE stage
  WHEN 'New' THEN 1
  WHEN 'Contacted' THEN 2
  WHEN 'Tour Scheduled' THEN 3
  WHEN 'Tour Completed' THEN 4
  WHEN 'Applied' THEN 5
  WHEN 'Leased' THEN 6
  WHEN 'Lost' THEN 7
END;

-- ────────────────────────────────────────────────────────────
-- 6. advance_lead_stage() RPC
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.advance_lead_stage(
  p_lead_id   uuid,
  p_new_stage text,
  p_notes     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_stage text;
BEGIN
  SELECT stage INTO v_old_stage FROM public.leads WHERE id = p_lead_id;

  IF v_old_stage IS NULL THEN
    RAISE EXCEPTION 'Lead not found: %', p_lead_id;
  END IF;

  -- Update stage
  UPDATE public.leads
  SET stage = p_new_stage,
      lost_reason = CASE WHEN p_new_stage = 'Lost' THEN p_notes ELSE lost_reason END
  WHERE id = p_lead_id;

  -- Auto-create activity record
  INSERT INTO public.lead_activities (lead_id, activity_type, description, created_by)
  VALUES (
    p_lead_id,
    'stage_change',
    'Stage changed from ' || v_old_stage || ' to ' || p_new_stage ||
      CASE WHEN p_notes IS NOT NULL THEN ': ' || p_notes ELSE '' END,
    auth.uid()
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. Feature flag
-- ────────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description)
VALUES ('leasing_crm', true, 'Lead pipeline and tour management')
ON CONFLICT (key) DO NOTHING;

COMMIT;
