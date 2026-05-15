-- ============================================================================
-- Migration 077: Co-Applicant Data Columns
--
-- The original `application_coapplicants` table only captured identity +
-- status (full_name, email, applicant_type, portal_token, submitted_at).
-- It deliberately had no per-co-applicant data fields because we were
-- undecided on the schema.
--
-- This migration adds the data each co-applicant needs to submit through
-- their portal at /apply/co/<portal_token>: contact, personal IDs (encrypted
-- via pgcrypto), current address (single flat row to keep it simple), basic
-- employment, and the 5 screening questions.
--
-- Pragmatic v1 choice: flat columns on the existing row rather than child
-- tables for phones/emails/addresses/etc. Co-applicants supply less data
-- than the primary; multiple addresses or phones can go in notes. If we
-- later need richer per-co-applicant data we can promote to child tables.
-- ============================================================================

BEGIN;

ALTER TABLE public.application_coapplicants
  -- Contact
  ADD COLUMN IF NOT EXISTS phone                       text,

  -- Personal IDs (encrypted via extensions.pgp_sym_encrypt; key in env)
  ADD COLUMN IF NOT EXISTS date_of_birth               date,
  ADD COLUMN IF NOT EXISTS ssn_encrypted               bytea,
  ADD COLUMN IF NOT EXISTS ssn_last_4                  text,
  ADD COLUMN IF NOT EXISTS gov_id_encrypted            bytea,
  ADD COLUMN IF NOT EXISTS gov_id_issuing_state        text,

  -- Current address (flat, single row)
  ADD COLUMN IF NOT EXISTS current_street_1            text,
  ADD COLUMN IF NOT EXISTS current_street_2            text,
  ADD COLUMN IF NOT EXISTS current_city                text,
  ADD COLUMN IF NOT EXISTS current_state               text,
  ADD COLUMN IF NOT EXISTS current_postal_code         text,
  ADD COLUMN IF NOT EXISTS current_occupancy_type      text,
  ADD COLUMN IF NOT EXISTS current_monthly_payment     numeric(12,2),
  ADD COLUMN IF NOT EXISTS current_landlord_name       text,
  ADD COLUMN IF NOT EXISTS current_landlord_phone      text,

  -- Employment basics
  ADD COLUMN IF NOT EXISTS employer                    text,
  ADD COLUMN IF NOT EXISTS employer_phone              text,
  ADD COLUMN IF NOT EXISTS position_held               text,
  ADD COLUMN IF NOT EXISTS years_worked                numeric(5,1),
  ADD COLUMN IF NOT EXISTS monthly_salary              numeric(12,2),
  ADD COLUMN IF NOT EXISTS supervisor_name             text,
  ADD COLUMN IF NOT EXISTS supervisor_email            text,

  -- Screening questions (mirror the primary applicant's 5)
  ADD COLUMN IF NOT EXISTS q_delinquent_payment        boolean,
  ADD COLUMN IF NOT EXISTS q_felony_conviction         boolean,
  ADD COLUMN IF NOT EXISTS q_sued_landlord             boolean,
  ADD COLUMN IF NOT EXISTS q_water_filled_furniture    boolean,
  ADD COLUMN IF NOT EXISTS q_smoker                    boolean,

  -- Free-form notes from the co-applicant
  ADD COLUMN IF NOT EXISTS notes                       text;

-- Status check: keep the existing values but expand allowed set
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'application_coapplicants_status_check'
  ) THEN
    ALTER TABLE public.application_coapplicants
      DROP CONSTRAINT application_coapplicants_status_check;
  END IF;
END$$;

ALTER TABLE public.application_coapplicants
  ADD CONSTRAINT application_coapplicants_status_check
  CHECK (status IN ('Invited', 'Started', 'Submitted', 'Declined'));


-- ============================================================================
-- 2. Tag attachments with the co-applicant who uploaded them.
--    Nullable: NULL means uploaded by the primary applicant.
-- ============================================================================

ALTER TABLE public.application_attachments
  ADD COLUMN IF NOT EXISTS coapplicant_id uuid
    REFERENCES public.application_coapplicants(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_application_attachments_coapplicant
  ON public.application_attachments(coapplicant_id)
  WHERE coapplicant_id IS NOT NULL;


COMMIT;
