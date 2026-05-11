-- ============================================================
-- 066_preapproved_applications_and_leads_link.sql
--
-- 1. Adds 'Preapproved' as a valid application status so a PM can
--    move a promising applicant into the Leasing CRM pipeline as
--    a Lead (stage='Applied') before committing to tenant/lease
--    creation.
-- 2. Enforces a one-to-one mapping between applications and leads
--    via a partial unique index on leads.application_id — repeat
--    preapproval clicks are now a no-op instead of a duplicate.
-- ============================================================

-- 1. Relax applications.status to include Preapproved.
ALTER TABLE public.applications
  DROP CONSTRAINT IF EXISTS applications_status_check;

ALTER TABLE public.applications
  ADD CONSTRAINT applications_status_check
  CHECK (status IS NULL OR status IN (
    'Pending',
    'Preapproved',
    'Approved',
    'Denied',
    'Withdrawn'
  ));

-- 2. One lead per application. Partial so leads captured from other
--    sources (no application_id) are not affected.
CREATE UNIQUE INDEX IF NOT EXISTS ux_leads_application_id
  ON public.leads(application_id)
  WHERE application_id IS NOT NULL;

COMMENT ON INDEX public.ux_leads_application_id IS
  'Prevents duplicate leads when preapproveApplication is called more than once for the same application.';
