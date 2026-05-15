-- ============================================================================
-- Migration 076: Application Attachments Storage Bucket
--
-- Creates a private storage bucket for files uploaded with rental applications
-- (proof of income, ID copies, pet records, etc.).
--
-- Path convention:  {application_id}/{filename}
-- Visibility:       Private bucket (NOT public-read like listings)
-- Allowed types:    PDF, JPG/JPEG, PNG, DOC/DOCX, HEIC
-- Max size:         10MB per file (enforced via bucket setting)
--
-- ACCESS MODEL (all writes via server actions with service role):
--   - Anon/draft-stage uploads:    server action validates draft_token, then
--                                  uses service role to write. The bucket's
--                                  RLS for clients is therefore "no direct
--                                  client writes" — only INSERTs blocked here
--                                  go through the server action's encrypted path.
--   - Admin / property-scoped reads: can read attachments for applications
--                                  whose unit's property is in their scope.
--   - Co-applicants:               read their parent application's attachments
--                                  via the co-applicant portal's server actions
--                                  (also service role).
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. CREATE THE BUCKET (idempotent)
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'application-attachments',
  'application-attachments',
  false,                                                 -- private
  10485760,                                              -- 10MB
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ============================================================================
-- 2. STORAGE RLS POLICIES
--
-- The bucket is private. By default no one but the bucket owner can do
-- anything. We add policies for authenticated reads tied to property access.
-- We deliberately do NOT add a client-side INSERT policy — uploads only
-- happen through the server action, which uses service role and bypasses RLS.
-- ============================================================================

-- READ: a user can see an attachment iff they can see the parent application
-- (which is property-scoped via 071b's applications_scoped_read).
DROP POLICY IF EXISTS "application_attachments_scoped_read" ON storage.objects;
CREATE POLICY "application_attachments_scoped_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'application-attachments'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM public.applications
    )
  );

-- DELETE: admin or property-scoped management can remove attachments.
DROP POLICY IF EXISTS "application_attachments_scoped_delete" ON storage.objects;
CREATE POLICY "application_attachments_scoped_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'application-attachments'
    AND (
      public.is_admin()
      OR (storage.foldername(name))[1]::uuid IN (
        SELECT a.id
        FROM public.applications a
        WHERE a.unit_id IN (SELECT public.user_unit_ids())
      )
    )
  );

-- INSERT / UPDATE: NOT exposed to authenticated users. All file writes go
-- through the server action that uses service role + validates the
-- application's draft_token (server action checks the token matches an
-- existing applications.draft_token row before writing).


-- ============================================================================
-- 3. METADATA TABLE — file metadata so we can list, label, and reference
--    attachments without re-querying storage every time.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.application_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.applications(id) ON DELETE CASCADE,
  file_name       text NOT NULL,        -- original filename from the applicant
  file_path       text NOT NULL,        -- storage path: {application_id}/{uuid-prefixed-filename}
  file_size       bigint,
  mime_type       text,
  label           text,                 -- optional applicant-supplied note ("paystub Jan 2026")
  uploaded_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT application_attachments_path_unique UNIQUE (file_path)
);

CREATE INDEX IF NOT EXISTS idx_application_attachments_app
  ON public.application_attachments(application_id);

ALTER TABLE public.application_attachments ENABLE ROW LEVEL SECURITY;

-- Same scoping rule as the storage policy
CREATE POLICY "application_attachments_meta_scoped_read"
  ON public.application_attachments
  FOR SELECT TO authenticated
  USING (application_id IN (SELECT id FROM public.applications));


COMMIT;
