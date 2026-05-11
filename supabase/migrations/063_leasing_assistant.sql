-- ============================================================================
-- Migration 063: AI Leasing Assistant
--
-- Creates ai_drafts — AI-generated outbound drafts (SMS + email) per lead,
-- produced by the leasing-assistant edge function (GPT-4o Mini).
-- Drafts are reviewed by a human in LeasingAiDraftModal before sending.
-- Sending flips sent_at / sent_channel and logs a lead_activities row.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_drafts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id               uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  generated_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  model                 text NOT NULL,                -- e.g. "gpt-4o-mini"
  prompt_tokens         integer,
  completion_tokens     integer,
  subject               text,                         -- email subject line
  body_text             text,                         -- plain-text email body
  body_html             text,                         -- HTML email body
  sms_text              text,                         -- SMS-sized outbound message (<= ~480 chars)
  suggested_questions   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- string[]: qualifying Qs for rep to ask
  suggested_actions     jsonb NOT NULL DEFAULT '[]'::jsonb,   -- { label, url }[]: CTAs like "Apply now"
  context_snapshot      jsonb,                        -- what the model saw (unit, listing, lead)
  sent_at               timestamptz,
  sent_channel          text CHECK (sent_channel IS NULL OR sent_channel IN ('sms', 'email', 'both')),
  sent_by               uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_drafts_lead_id ON public.ai_drafts(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_drafts_sent_at ON public.ai_drafts(sent_at);

COMMENT ON TABLE public.ai_drafts IS 'AI-generated outbound drafts for leads — awaiting human review before send.';

-- RLS: Management roles have full access; nobody else can see drafts.
ALTER TABLE public.ai_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_drafts_management_all
  ON public.ai_drafts FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- Feature flag so the UI/edge function can be toggled globally.
INSERT INTO public.feature_flags (key, value, description)
VALUES ('leasing_ai_assistant', true, 'AI-generated outbound drafts for leads')
ON CONFLICT (key) DO NOTHING;

COMMIT;
