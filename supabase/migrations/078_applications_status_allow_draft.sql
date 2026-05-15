-- ============================================================================
-- Migration 078: Allow 'Draft' status on applications
--
-- The original CHECK constraint (from migration 001-era schema) only
-- permitted: Pending, Preapproved, Approved, Denied, Withdrawn.
--
-- Phase 4's wizard creates rows with status='Draft' before the applicant
-- submits, so we need to extend the allowed set.
--
-- We deliberately do NOT add a 'Submitted' value — submitApplication() sets
-- status='Pending' on submit so the new application lands in the existing
-- admin pipeline's default filter. The actual "submitted" signal is
-- `submitted_at IS NOT NULL`.
-- ============================================================================

BEGIN;

ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_status_check
  CHECK (
    status IS NULL
    OR status = ANY (ARRAY[
      'Draft'::text,
      'Pending'::text,
      'Preapproved'::text,
      'Approved'::text,
      'Denied'::text,
      'Withdrawn'::text
    ])
  );

COMMIT;
