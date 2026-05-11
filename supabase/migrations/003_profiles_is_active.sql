-- ============================================================
-- RYLEXA PM - MIGRATION 003
-- Adds is_active flag to profiles for soft-disable functionality
--
-- RUN THIS IN: Supabase Dashboard > SQL Editor
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;
