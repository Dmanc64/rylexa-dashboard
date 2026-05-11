-- ============================================================
-- 035_document_management.sql
-- Centralized document management: table, RLS, storage
-- policies, indexes, and feature flag.
-- ============================================================

-- ── 1A. documents table ────────────────────────────────────
CREATE TABLE public.documents (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title         text NOT NULL,
  document_type text NOT NULL CHECK (document_type IN (
    'lease_agreement','notice','inspection','receipt',
    'photo','insurance','tax','other'
  )),
  entity_type   text NOT NULL CHECK (entity_type IN (
    'property','unit','lease','tenant','work_order'
  )),
  entity_id     uuid NOT NULL,
  file_path     text NOT NULL,
  file_name     text NOT NULL,
  file_size     bigint NOT NULL,
  mime_type     text NOT NULL,
  notes         text,
  is_shared     boolean NOT NULL DEFAULT false,
  shared_with   text[] DEFAULT '{}',
  uploaded_by   uuid NOT NULL REFERENCES public.profiles(id),
  created_at    timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.documents IS 'Centralized document metadata for all uploaded files linked to entities.';
COMMENT ON COLUMN public.documents.entity_id IS 'Polymorphic FK — references property, unit, lease, tenant, or work_order depending on entity_type.';
COMMENT ON COLUMN public.documents.shared_with IS 'Array of role names that can view this doc when is_shared=true.';

-- ── 1B. Indexes ────────────────────────────────────────────
CREATE INDEX idx_documents_entity ON public.documents(entity_type, entity_id);
CREATE INDEX idx_documents_type ON public.documents(document_type);
CREATE INDEX idx_documents_uploaded_by ON public.documents(uploaded_by);
CREATE INDEX idx_documents_shared ON public.documents(is_shared) WHERE is_shared = true;

-- ── 1C. RLS ────────────────────────────────────────────────
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full access to documents"
  ON public.documents FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Tenants read shared documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'Tenant'
    AND is_shared = true
    AND 'Tenant' = ANY(shared_with)
    AND (
      (entity_type = 'lease' AND entity_id IN (
        SELECT l.id FROM public.leases l WHERE l.user_id = (SELECT auth.uid())
      ))
      OR
      (entity_type = 'unit' AND entity_id IN (
        SELECT l.unit_id FROM public.leases l
        WHERE l.user_id = (SELECT auth.uid()) AND l.status = 'Active'
      ))
      OR
      (entity_type = 'property' AND entity_id IN (
        SELECT u.property_id FROM public.units u
        JOIN public.leases l ON l.unit_id = u.id
        WHERE l.user_id = (SELECT auth.uid()) AND l.status = 'Active'
      ))
      OR
      (entity_type = 'tenant' AND entity_id IN (SELECT public.get_my_tenant_ids()))
    )
  );

CREATE POLICY "Owners read shared documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'Owner'
    AND is_shared = true
    AND 'Owner' = ANY(shared_with)
    AND (
      (entity_type = 'property' AND entity_id IN (
        SELECT p.id FROM public.properties p
        WHERE p.owner_id = (SELECT public.get_my_owner_id())
      ))
      OR
      (entity_type = 'unit' AND entity_id IN (
        SELECT u.id FROM public.units u
        JOIN public.properties p ON u.property_id = p.id
        WHERE p.owner_id = (SELECT public.get_my_owner_id())
      ))
      OR
      (entity_type = 'lease' AND entity_id IN (
        SELECT l.id FROM public.leases l
        JOIN public.units u ON l.unit_id = u.id
        JOIN public.properties p ON u.property_id = p.id
        WHERE p.owner_id = (SELECT public.get_my_owner_id())
      ))
    )
  );

CREATE POLICY "Vendors read shared documents"
  ON public.documents FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'Vendor'
    AND is_shared = true
    AND 'Vendor' = ANY(shared_with)
    AND entity_type = 'work_order'
    AND entity_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.vendor_id = (SELECT public.get_my_vendor_id())
    )
  );

-- ── 1D. Storage bucket policies ────────────────────────────
-- Bucket 'documents' created separately (private, not public).

CREATE POLICY "Management upload documents"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND public.is_management()
  );

CREATE POLICY "Management delete documents"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND public.is_management()
  );

CREATE POLICY "Authenticated read documents bucket"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'documents');

-- ── 1E. Feature flag ──────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('document_management', true, 'Enable centralized document management')
ON CONFLICT (key) DO NOTHING;
