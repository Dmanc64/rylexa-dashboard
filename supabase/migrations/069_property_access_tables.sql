-- ============================================================================
-- Migration 069: Property Access — New Tables + Backfill
--
-- Foundation for granular per-property access control:
-- 1. property_access      — N:N table of (user, property, access_level)
-- 2. owner_entity_members — N:N table of (owner_entity, user) replacing the
--                           1:1 owners.user_id link. Lets one user represent
--                           multiple owner entities and one entity have
--                           multiple users.
-- 3. Backfill owner_entity_members from existing owners.user_id rows
-- 4. Mark owners.user_id deprecated (drop in a later migration)
-- 5. RLS on the new tables (admin manage, users read own rows)
-- 6. Indexes
--
-- This migration is purely additive — no existing access changes here.
-- The narrowing of property visibility happens in migration 071*.
--
-- ROLLBACK: DROP TABLE property_access CASCADE; DROP TABLE owner_entity_members CASCADE;
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. property_access — per-property grants for non-admin roles
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.property_access (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id   uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_level     text NOT NULL CHECK (access_level IN (
                     'Property Manager',   -- full management of the property
                     'Accounting',         -- $ access; tier defined by permission_tier
                     'Owner'               -- read-like-an-owner (per-property grant)
                   )),
  -- No DEFAULT — must be set explicitly. CHECK below enforces correct pairing.
  permission_tier  text NOT NULL CHECK (permission_tier IN ('full', 'read')),
  granted_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz,         -- NULL = no expiry
  notes            text,
  CONSTRAINT property_access_unique
    UNIQUE (property_id, user_id, access_level),
  -- Tier consistency: PM is always full; Owner is always read; Accounting picks
  CONSTRAINT property_access_tier_consistency CHECK (
    (access_level = 'Property Manager' AND permission_tier = 'full') OR
    (access_level = 'Owner'            AND permission_tier = 'read') OR
    (access_level = 'Accounting'       AND permission_tier IN ('full', 'read'))
  )
);

COMMENT ON TABLE public.property_access IS
  'Per-property access grants for Property Manager, Accounting, and one-off Owner roles. Labels match the user-roles dropdown on /admin/settings/users. Admin role bypasses this table; Maintenance/Vendor/Tenant scope through other relationships.';

COMMENT ON COLUMN public.property_access.access_level IS
  'Property Manager = full mgmt; Accounting = $ access (tier set by permission_tier); Owner = read-like-an-owner. For typical owner cross-viewing, prefer adding the user as a viewer in owner_entity_members rather than per-property Owner rows here.';

COMMENT ON COLUMN public.property_access.permission_tier IS
  'Only meaningful for Accounting (full = post charges/payments; read = view-only). Auto-locked to "full" for Property Manager and "read" for Owner via property_access_tier_consistency.';

COMMENT ON COLUMN public.property_access.expires_at IS
  'Optional auto-revoke. NULL means permanent. Use for temporary contractor access.';

ALTER TABLE public.property_access ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 2. owner_entity_members — N:N replacement for owners.user_id
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.owner_entity_members (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  member_role   text NOT NULL DEFAULT 'viewer'
                CHECK (member_role IN ('admin', 'viewer')),
  granted_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_entity_members_unique UNIQUE (owner_id, user_id)
);

COMMENT ON TABLE public.owner_entity_members IS
  'Maps auth users to owner entities. A user can belong to many entities (consolidated investor view); an entity can have many users (LLC + bookkeeper).';

COMMENT ON COLUMN public.owner_entity_members.member_role IS
  'admin = can edit owner entity record; viewer = read-only on the entity and its properties.';

ALTER TABLE public.owner_entity_members ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- 3. Backfill owner_entity_members from existing owners.user_id
-- ============================================================================

INSERT INTO public.owner_entity_members (owner_id, user_id, member_role, granted_at)
SELECT id, user_id, 'admin', created_at
FROM public.owners
WHERE user_id IS NOT NULL
ON CONFLICT (owner_id, user_id) DO NOTHING;


-- ============================================================================
-- 4. Mark owners.user_id deprecated (don't drop yet — wait for one release)
-- ============================================================================

COMMENT ON COLUMN public.owners.user_id IS
  'DEPRECATED — use owner_entity_members instead. Kept for backwards compatibility; will be dropped in a future migration.';


-- ============================================================================
-- 5. Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_property_access_user
  ON public.property_access (user_id);

CREATE INDEX IF NOT EXISTS idx_property_access_property
  ON public.property_access (property_id);

-- Composite for the hot RLS path. expires_at included so queries that filter
-- "expires_at IS NULL OR > now()" can do an index-only scan.
-- (Note: we deliberately do NOT use `WHERE expires_at > now()` as a partial-index
-- predicate — Postgres bakes now() at CREATE INDEX time and the index goes stale.)
CREATE INDEX IF NOT EXISTS idx_property_access_user_lvl
  ON public.property_access (user_id, access_level, property_id, expires_at);

-- Permanent grants (the common case) — partial index using only IS NULL,
-- which is immutable and won't go stale.
CREATE INDEX IF NOT EXISTS idx_property_access_permanent
  ON public.property_access (user_id, access_level, property_id)
  WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_owner_members_user
  ON public.owner_entity_members (user_id);

CREATE INDEX IF NOT EXISTS idx_owner_members_owner
  ON public.owner_entity_members (owner_id);


-- ============================================================================
-- 6. Recursion-safe helper for co-member visibility
--
-- A policy on owner_entity_members that queries owner_entity_members would
-- recurse (the subquery re-triggers RLS — same bug 017 fixed). We wrap the
-- lookup in a SECURITY DEFINER function so it bypasses RLS internally.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.my_owner_entity_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT owner_id
  FROM public.owner_entity_members
  WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.my_owner_entity_ids() TO authenticated;


-- ============================================================================
-- 7. RLS policies on the new tables
--
-- - Admins can do anything on both tables (manage all assignments).
-- - Authenticated users can read their own rows so they can see what they
--   have access to (UI surfaces this in the user profile / settings page).
-- - Owner-entity members can see other members of the same entity (via the
--   recursion-safe helper above).
-- - No one else can read or write directly — server actions use service role
--   for cross-user grants and rely on is_admin() server-side check.
-- ============================================================================

-- property_access policies
CREATE POLICY "property_access_admin_all" ON public.property_access
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "property_access_self_read" ON public.property_access
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- owner_entity_members policies
CREATE POLICY "owner_members_admin_all" ON public.owner_entity_members
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "owner_members_self_read" ON public.owner_entity_members
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Members of an owner entity can see other members of the same entity
-- (so Tom can see that Jane is a co-member of ACME Holdings).
-- Uses the SECURITY DEFINER helper to avoid recursive RLS evaluation.
CREATE POLICY "owner_members_co_member_read" ON public.owner_entity_members
  FOR SELECT TO authenticated
  USING (owner_id IN (SELECT public.my_owner_entity_ids()));

COMMIT;
