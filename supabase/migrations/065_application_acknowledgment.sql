-- ============================================================
-- 065_application_acknowledgment.sql
-- Track when an acknowledgment email has been sent for an
-- application so the notify-application-received edge function
-- is idempotent (one email per application, no replay spam).
-- ============================================================

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS acknowledgment_email_sent_at timestamptz;

COMMENT ON COLUMN public.applications.acknowledgment_email_sent_at IS
  'Set by the notify-application-received edge function after successfully sending the "application received" email to the applicant. NULL means no email has been sent yet; non-NULL blocks further sends.';
