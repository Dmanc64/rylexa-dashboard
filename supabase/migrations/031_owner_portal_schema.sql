-- ============================================================================
-- Migration 031: Owner Portal Schema
--
-- Creates the data model for the Owner Portal feature:
-- 1. owners table (linked to auth.users for login)
-- 2. properties.owner_id FK (property-to-owner relationship)
-- 3. distributions table (payout tracking)
-- 4. distribution_summary view (fixes broken useDistributions hook)
-- 5. owner_financial_summary view (aggregate per-owner financials)
-- 6. Add 'Owner' to profiles role constraint
-- 7. RLS helper functions: is_owner(), get_my_owner_id()
-- 8. RLS policies for owners, distributions, and owner access to properties
-- 9. Performance indexes
-- ============================================================================


-- ============================================================================
-- 1. OWNERS TABLE
-- ============================================================================

CREATE TABLE public.owners (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name  text NOT NULL,
  email      text NOT NULL,
  phone      text,
  company_name text,
  notes      text,
  created_at timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.owners IS 'Property owners who receive distributions and view financials via the Owner Portal';
COMMENT ON COLUMN public.owners.user_id IS 'Links to auth.users for portal login. NULL if owner has no portal access yet.';

ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 2. PROPERTIES.OWNER_ID FK
-- ============================================================================

ALTER TABLE public.properties
  ADD COLUMN owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.properties.owner_id IS 'The owner of this property. NULL if unassigned.';


-- ============================================================================
-- 3. DISTRIBUTIONS TABLE
-- ============================================================================

CREATE TABLE public.distributions (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id      uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  property_id   uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  amount        numeric NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'Pending'
                CHECK (status IN ('Pending', 'Processing', 'Completed', 'Failed')),
  period_start  date,
  period_end    date,
  notes         text,
  processed_at  timestamptz,
  created_at    timestamptz DEFAULT now() NOT NULL
);

COMMENT ON TABLE public.distributions IS 'Tracks owner payout distributions with status lifecycle';

ALTER TABLE public.distributions ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 4. DISTRIBUTION_SUMMARY VIEW
-- Fixes the broken useDistributions hook which queries this non-existent view.
-- Returns: property_id, property_name, owner_id, owner_name,
--          total_income, total_expenses, net_balance
-- ============================================================================

DROP VIEW IF EXISTS public.distribution_summary;

CREATE VIEW public.distribution_summary AS
SELECT
  p.id          AS property_id,
  p.name        AS property_name,
  o.id          AS owner_id,
  o.full_name   AS owner_name,
  COALESCE(pnl.total_income, 0)            AS total_income,
  COALESCE(pnl.total_expenses, 0)          AS total_expenses,
  COALESCE(pnl.net_operating_income, 0)    AS net_balance
FROM public.properties p
LEFT JOIN public.owners o ON p.owner_id = o.id
LEFT JOIN public.view_profit_and_loss pnl ON pnl.id = p.id;


-- ============================================================================
-- 5. OWNER_FINANCIAL_SUMMARY VIEW
-- Aggregates financials across all properties owned by each owner.
-- ============================================================================

CREATE OR REPLACE VIEW public.owner_financial_summary AS
SELECT
  o.id                                          AS owner_id,
  o.full_name                                   AS owner_name,
  COUNT(DISTINCT p.id)                          AS property_count,
  COUNT(DISTINCT u.id)                          AS total_units,
  COUNT(DISTINCT u.id) FILTER (WHERE u.status = 'Occupied') AS occupied_units,
  COALESCE(SUM(pnl.total_income), 0)           AS total_income,
  COALESCE(SUM(pnl.total_expenses), 0)         AS total_expenses,
  COALESCE(SUM(pnl.net_operating_income), 0)   AS net_operating_income,
  COALESCE(dist.total_distributed, 0)           AS total_distributed
FROM public.owners o
LEFT JOIN public.properties p ON p.owner_id = o.id
LEFT JOIN public.units u ON u.property_id = p.id
LEFT JOIN public.view_profit_and_loss pnl ON pnl.id = p.id
LEFT JOIN (
  SELECT owner_id, SUM(amount) AS total_distributed
  FROM public.distributions
  WHERE status = 'Completed'
  GROUP BY owner_id
) dist ON dist.owner_id = o.id
GROUP BY o.id, o.full_name, dist.total_distributed;


-- ============================================================================
-- 6. ADD 'Owner' TO PROFILES ROLE CONSTRAINT
-- ============================================================================

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('Admin', 'Property Manager', 'Accounting', 'Maintenance', 'Vendor', 'Tenant', 'Owner'));


-- ============================================================================
-- 7. RLS HELPER FUNCTIONS
-- ============================================================================

-- Returns the owner.id for the currently authenticated user (matched by user_id)
CREATE OR REPLACE FUNCTION public.get_my_owner_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_owner_id uuid;
BEGIN
  SELECT id INTO v_owner_id
  FROM public.owners
  WHERE user_id = (SELECT auth.uid());
  RETURN v_owner_id;
END;
$$;

-- Returns true if current user has the Owner role
CREATE OR REPLACE FUNCTION public.is_owner()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = (SELECT auth.uid())) = 'Owner';
END;
$$;


-- ============================================================================
-- 8. RLS POLICIES
-- ============================================================================

-- ---- owners table ----

-- Management (Admin/PM) can do everything on owners
CREATE POLICY "Management full access to owners"
  ON public.owners FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- Accounting can read owners
CREATE POLICY "Accounting read owners"
  ON public.owners FOR SELECT
  TO authenticated
  USING (public.get_my_role() = 'Accounting');

-- Owners can read their own record
CREATE POLICY "Owners read own record"
  ON public.owners FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ---- distributions table ----

-- Management can do everything on distributions
CREATE POLICY "Management full access to distributions"
  ON public.distributions FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- Accounting can read distributions
CREATE POLICY "Accounting read distributions"
  ON public.distributions FOR SELECT
  TO authenticated
  USING (public.get_my_role() = 'Accounting');

-- Owners can read their own distributions
CREATE POLICY "Owners read own distributions"
  ON public.distributions FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT public.get_my_owner_id()));

-- ---- properties table (add Owner read access) ----

-- Owners can read their own properties
CREATE POLICY "Owners read own properties"
  ON public.properties FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_my_role()) = 'Owner'
    AND owner_id IN (SELECT id FROM public.owners WHERE user_id = (SELECT auth.uid()))
  );


-- ============================================================================
-- 9. INDEXES
-- ============================================================================

-- Fix views to use caller's RLS (security invoker) instead of view owner's permissions
ALTER VIEW public.distribution_summary SET (security_invoker = on);
ALTER VIEW public.owner_financial_summary SET (security_invoker = on);


CREATE INDEX IF NOT EXISTS idx_owners_user_id ON public.owners(user_id);
CREATE INDEX IF NOT EXISTS idx_properties_owner_id ON public.properties(owner_id);
CREATE INDEX IF NOT EXISTS idx_distributions_owner_id ON public.distributions(owner_id);
CREATE INDEX IF NOT EXISTS idx_distributions_property_id ON public.distributions(property_id);
CREATE INDEX IF NOT EXISTS idx_distributions_status ON public.distributions(status);
CREATE INDEX IF NOT EXISTS idx_distributions_created_at ON public.distributions(created_at DESC);
