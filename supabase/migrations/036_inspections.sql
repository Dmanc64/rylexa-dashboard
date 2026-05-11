-- ============================================================
-- 036_inspections.sql
-- Inspections & Checklists: tables, indexes, RLS, trigger,
-- feature flag.
-- ============================================================

-- ── 1A. inspections table ────────────────────────────────────
CREATE TABLE public.inspections (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id         uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  lease_id        uuid REFERENCES public.leases(id) ON DELETE SET NULL,
  inspection_type text NOT NULL CHECK (inspection_type IN (
    'move_in','move_out','periodic','pre_listing'
  )),
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled','in_progress','completed','reviewed'
  )),
  scheduled_date  date,
  completed_date  timestamptz,
  inspector_id    uuid NOT NULL REFERENCES public.profiles(id),
  overall_notes   text,
  overall_score   text CHECK (overall_score IN ('good','fair','poor') OR overall_score IS NULL),
  pdf_path        text,
  is_shared       boolean NOT NULL DEFAULT false,
  shared_with     text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now() NOT NULL,
  updated_at      timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.inspections IS 'Property inspection records linked to units and optionally leases.';
COMMENT ON COLUMN public.inspections.pdf_path IS 'Storage path to the generated PDF report in the documents bucket.';
COMMENT ON COLUMN public.inspections.shared_with IS 'Array of role names that can view when is_shared=true.';

-- ── 1B. inspection_areas table ───────────────────────────────
CREATE TABLE public.inspection_areas (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  inspection_id   uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  area_name       text NOT NULL,
  condition       text CHECK (condition IN ('good','fair','poor','na') OR condition IS NULL),
  notes           text,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.inspection_areas IS 'Per-area checklist items within an inspection.';

-- ── 1C. inspection_photos table ──────────────────────────────
CREATE TABLE public.inspection_photos (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  area_id         uuid NOT NULL REFERENCES public.inspection_areas(id) ON DELETE CASCADE,
  file_path       text NOT NULL,
  file_name       text NOT NULL,
  file_size       bigint NOT NULL DEFAULT 0,
  mime_type       text NOT NULL DEFAULT 'image/jpeg',
  caption         text,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.inspection_photos IS 'Photos uploaded per inspection area, stored in the documents bucket.';

-- ── 2. Indexes ───────────────────────────────────────────────
CREATE INDEX idx_inspections_unit ON public.inspections(unit_id);
CREATE INDEX idx_inspections_lease ON public.inspections(lease_id) WHERE lease_id IS NOT NULL;
CREATE INDEX idx_inspections_status ON public.inspections(status);
CREATE INDEX idx_inspections_type ON public.inspections(inspection_type);
CREATE INDEX idx_inspections_inspector ON public.inspections(inspector_id);
CREATE INDEX idx_inspections_scheduled ON public.inspections(scheduled_date);
CREATE INDEX idx_inspections_shared ON public.inspections(is_shared) WHERE is_shared = true;
CREATE INDEX idx_inspection_areas_inspection ON public.inspection_areas(inspection_id);
CREATE INDEX idx_inspection_photos_area ON public.inspection_photos(area_id);

-- ── 3A. RLS — inspections ────────────────────────────────────
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full access to inspections"
  ON public.inspections FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Tenants read shared inspections"
  ON public.inspections FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'Tenant'
    AND is_shared = true
    AND 'Tenant' = ANY(shared_with)
    AND (
      (lease_id IS NOT NULL AND lease_id IN (
        SELECT l.id FROM public.leases l WHERE l.user_id = (SELECT auth.uid())
      ))
      OR
      (unit_id IN (
        SELECT l.unit_id FROM public.leases l
        WHERE l.user_id = (SELECT auth.uid()) AND l.status = 'Active'
      ))
    )
  );

CREATE POLICY "Owners read shared inspections"
  ON public.inspections FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'Owner'
    AND is_shared = true
    AND 'Owner' = ANY(shared_with)
    AND unit_id IN (
      SELECT u.id FROM public.units u
      JOIN public.properties p ON u.property_id = p.id
      WHERE p.owner_id = (SELECT public.get_my_owner_id())
    )
  );

-- ── 3B. RLS — inspection_areas ───────────────────────────────
ALTER TABLE public.inspection_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full access to inspection_areas"
  ON public.inspection_areas FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Tenants read shared inspection areas"
  ON public.inspection_areas FOR SELECT
  TO authenticated
  USING (
    inspection_id IN (
      SELECT id FROM public.inspections
      WHERE is_shared = true
        AND 'Tenant' = ANY(shared_with)
        AND (SELECT public.get_my_role()) = 'Tenant'
        AND (
          (lease_id IS NOT NULL AND lease_id IN (
            SELECT l.id FROM public.leases l WHERE l.user_id = (SELECT auth.uid())
          ))
          OR unit_id IN (
            SELECT l.unit_id FROM public.leases l
            WHERE l.user_id = (SELECT auth.uid()) AND l.status = 'Active'
          )
        )
    )
  );

CREATE POLICY "Owners read shared inspection areas"
  ON public.inspection_areas FOR SELECT
  TO authenticated
  USING (
    inspection_id IN (
      SELECT id FROM public.inspections
      WHERE is_shared = true
        AND 'Owner' = ANY(shared_with)
        AND (SELECT public.get_my_role()) = 'Owner'
        AND unit_id IN (
          SELECT u.id FROM public.units u
          JOIN public.properties p ON u.property_id = p.id
          WHERE p.owner_id = (SELECT public.get_my_owner_id())
        )
    )
  );

-- ── 3C. RLS — inspection_photos ──────────────────────────────
ALTER TABLE public.inspection_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management full access to inspection_photos"
  ON public.inspection_photos FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Tenants read shared inspection photos"
  ON public.inspection_photos FOR SELECT
  TO authenticated
  USING (
    area_id IN (
      SELECT ia.id FROM public.inspection_areas ia
      JOIN public.inspections i ON ia.inspection_id = i.id
      WHERE i.is_shared = true
        AND 'Tenant' = ANY(i.shared_with)
        AND (SELECT public.get_my_role()) = 'Tenant'
        AND (
          (i.lease_id IS NOT NULL AND i.lease_id IN (
            SELECT l.id FROM public.leases l WHERE l.user_id = (SELECT auth.uid())
          ))
          OR i.unit_id IN (
            SELECT l.unit_id FROM public.leases l
            WHERE l.user_id = (SELECT auth.uid()) AND l.status = 'Active'
          )
        )
    )
  );

CREATE POLICY "Owners read shared inspection photos"
  ON public.inspection_photos FOR SELECT
  TO authenticated
  USING (
    area_id IN (
      SELECT ia.id FROM public.inspection_areas ia
      JOIN public.inspections i ON ia.inspection_id = i.id
      WHERE i.is_shared = true
        AND 'Owner' = ANY(i.shared_with)
        AND (SELECT public.get_my_role()) = 'Owner'
        AND i.unit_id IN (
          SELECT u.id FROM public.units u
          JOIN public.properties p ON u.property_id = p.id
          WHERE p.owner_id = (SELECT public.get_my_owner_id())
        )
    )
  );

-- ── 4. updated_at trigger ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_inspections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_inspections_updated_at
  BEFORE UPDATE ON public.inspections
  FOR EACH ROW EXECUTE FUNCTION public.set_inspections_updated_at();

-- ── 5. Feature flag ──────────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('inspections', true, 'Enable Inspections & Checklists feature')
ON CONFLICT (key) DO NOTHING;
