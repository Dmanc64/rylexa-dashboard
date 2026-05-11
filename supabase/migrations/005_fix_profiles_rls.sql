-- ============================================================
-- RYLEXA PM - MIGRATION 005
-- Fixes the recursive RLS policy on profiles that causes 500 errors.
--
-- The "Admins can read all profiles" policy queried the profiles
-- table from within its own RLS check, creating infinite recursion.
-- This replaces it with a simple policy allowing all authenticated
-- users to read all profiles (profiles only contain role/name).
-- ============================================================

-- Drop the broken recursive policy
DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;

-- Drop the self-only policy (will be replaced by broader one)
DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;

-- Single simple policy: authenticated users can read all profiles
-- This is needed by: middleware (role check), sidebar (name/role),
-- user management page (list all users), chat (sender names)
DO $$ BEGIN
  CREATE POLICY "Authenticated users can read profiles"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
