-- Migration 006: Fix profiles_role_check to include all valid roles
-- The existing CHECK constraint doesn't include 'Tenant' (and possibly 'Vendor'),
-- which prevents creating Tenant user profiles.

-- Drop the existing constraint (whatever values it currently allows)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Re-create with ALL valid roles
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('Admin', 'Property Manager', 'Maintenance', 'Vendor', 'Tenant'));
