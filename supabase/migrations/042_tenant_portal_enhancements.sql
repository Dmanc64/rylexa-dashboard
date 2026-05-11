-- ============================================================
-- 042_tenant_portal_enhancements.sql
-- Tenant Portal: work_order_images table, storage policies, feature flag
-- ============================================================

-- 1A. Feature flag
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('tenant_portal_v2', true, 'Enable enhanced tenant portal with shared layout and photo uploads')
ON CONFLICT (key) DO NOTHING;

-- 1B. work_order_images table
CREATE TABLE IF NOT EXISTS public.work_order_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer DEFAULT 0,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.work_order_images ENABLE ROW LEVEL SECURITY;

-- 1C. RLS: Tenants can view images on their own work orders
CREATE POLICY "Tenants read own WO images"
  ON public.work_order_images FOR SELECT
  USING (
    work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      JOIN public.leases l ON l.tenant_id = wo.tenant_id
      WHERE l.user_id = auth.uid()
    )
  );

-- 1D. RLS: Tenants can insert images on their own work orders
CREATE POLICY "Tenants insert own WO images"
  ON public.work_order_images FOR INSERT
  WITH CHECK (uploaded_by = auth.uid());

-- 1E. RLS: Staff can view/manage all
CREATE POLICY "Staff manage WO images"
  ON public.work_order_images FOR ALL
  USING (public.is_staff());

-- 1F. Storage policy: allow authenticated users to upload to maintenance-images bucket
CREATE POLICY "Tenants upload maintenance images"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'maintenance-images'
    AND auth.role() = 'authenticated'
  );

-- 1G. Index for fast lookups by work_order_id
CREATE INDEX IF NOT EXISTS idx_work_order_images_wo_id
  ON public.work_order_images (work_order_id);
