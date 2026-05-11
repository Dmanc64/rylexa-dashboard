-- ============================================================================
-- Migration 071f: Storage Bucket Policies — fix the two real leak surfaces
--
-- Two critical fixes:
--
-- 1. `documents` bucket — currently "Authenticated read documents bucket"
--    is `bucket_id = 'documents'` with no further check, meaning ANY
--    authenticated user can read every document. Replaced with a
--    documents-table-RLS-respecting policy.
--
-- 2. `property-images` bucket — currently "Authenticated users can
--    upload/update/delete property images" allows any authenticated user
--    to write directly via the client SDK. The legitimate flow goes
--    through a server action with service role, so locking these to
--    Admin/PM-with-property-access only doesn't affect normal use.
--
-- Other buckets (`leases`, `listings`, `maintenance-images`, `reports`,
-- `statements`) already have role-scoped policies and are left as-is.
-- Tightening those further (e.g., narrowing maintenance-images uploads
-- to "user can manage the WO via path") is a future enhancement.
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. DOCUMENTS bucket — table-RLS-respecting read
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated read documents bucket"  ON storage.objects;
DROP POLICY IF EXISTS "Finance can read documents"           ON storage.objects;
DROP POLICY IF EXISTS "Management upload documents"          ON storage.objects;
DROP POLICY IF EXISTS "Finance can upload documents"         ON storage.objects;
DROP POLICY IF EXISTS "Management delete documents"          ON storage.objects;

-- READ: only objects whose path matches a documents row the user can read
-- (the inner SELECT inherits the documents table's RLS automatically).
CREATE POLICY "documents_storage_scoped_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (SELECT 1 FROM public.documents d WHERE d.file_path = name)
  );

-- INSERT: anyone authenticated who can WRITE to the corresponding documents row.
-- Caller uploads first (path = file_path), then inserts the documents row.
-- We allow the upload if the destination path's entity is one they can manage
-- — since the file_path follows `{entity_type}/{entity_id}/...`, we can parse it.
CREATE POLICY "documents_storage_scoped_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (
      public.is_admin()
      OR (
        -- entity_type = first folder, entity_id = second folder
        (storage.foldername(name))[1] IN ('property', 'unit', 'lease', 'work_order')
        AND CASE (storage.foldername(name))[1]
          WHEN 'property'   THEN public.user_can_manage_property((storage.foldername(name))[2]::uuid)
          WHEN 'unit'       THEN public.user_can_manage_unit    ((storage.foldername(name))[2]::uuid)
          WHEN 'lease'      THEN public.user_can_manage_lease   ((storage.foldername(name))[2]::uuid)
          WHEN 'work_order' THEN ((storage.foldername(name))[2]::uuid IN (SELECT id FROM public.work_orders))
        END
      )
    )
  );

-- DELETE: only via the corresponding documents row (which has its own RLS).
CREATE POLICY "documents_storage_scoped_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM public.documents d
      WHERE d.file_path = name
        AND (
          public.is_admin()
          OR d.uploaded_by = (SELECT auth.uid())
          OR (d.entity_type = 'property'   AND public.user_can_manage_property(d.entity_id))
          OR (d.entity_type = 'unit'       AND public.user_can_manage_unit(d.entity_id))
          OR (d.entity_type = 'lease'      AND public.user_can_manage_lease(d.entity_id))
        )
    )
  );


-- ============================================================================
-- 2. PROPERTY-IMAGES bucket — admin-only direct writes
--    (Normal property image upload happens via a server action using the
--    service role, which bypasses RLS. Locking client-direct writes to
--    Admin only does not affect legitimate uploads.)
-- ============================================================================

DROP POLICY IF EXISTS "Authenticated users can upload property images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update property images" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete property images" ON storage.objects;

-- Public read stays (existing "Public read access for property images" — preserved)

CREATE POLICY "property_images_admin_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'property-images' AND public.is_admin());

CREATE POLICY "property_images_admin_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'property-images' AND public.is_admin())
  WITH CHECK (bucket_id = 'property-images' AND public.is_admin());

CREATE POLICY "property_images_admin_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'property-images' AND public.is_admin());

COMMIT;
