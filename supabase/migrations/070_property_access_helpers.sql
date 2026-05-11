-- ============================================================================
-- Migration 070: Property Access — Helper Functions
--
-- Single-source-of-truth functions used by every property-scoped RLS policy
-- in migration 071*. Centralizing the logic here means changing access rules
-- once, not in 30+ tables.
--
-- Functions:
--   user_property_ids(uuid)               SETOF uuid — property IDs a user can see
--   user_can_manage_property(uuid)        boolean    — can write/edit the property
--   user_can_view_property_financials     boolean    — can see $ data (read)
--   user_can_post_financials(uuid)        boolean    — can post charges/payments
--   user_property_access_level(uuid)      text       — highest label for the property
--
-- All functions are STABLE + SECURITY DEFINER + SET search_path = ''
-- Pattern matches migration 031's get_my_owner_id() / is_owner().
-- (The recursion-safe owner-entity helper my_owner_entity_ids() lives in 069
--  because an RLS policy in that migration depends on it.)
--
-- ROLLBACK: DROP FUNCTION user_property_ids, user_can_manage_property,
--           user_can_view_property_financials, user_can_post_financials,
--           user_property_access_level CASCADE;
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. user_property_ids(p_user_id) — the master visibility function
--
-- Returns property IDs the user can see, via three paths:
--   a) Admin role  → all properties
--   b) property_access grant (Property Manager / Accounting / Owner)
--   c) owner_entity_members → properties owned by those entities
--
-- Used in every property-scoped RLS policy.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_property_ids(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  -- Path (a): Admin sees everything
  SELECT p.id
  FROM public.properties p
  WHERE EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id
      AND role = 'Admin'
      AND COALESCE(is_active, true)
  )

  UNION

  -- Path (b): explicit property_access grants
  SELECT pa.property_id
  FROM public.property_access pa
  WHERE pa.user_id = p_user_id
    AND (pa.expires_at IS NULL OR pa.expires_at > now())

  UNION

  -- Path (c): membership in owner entities that own the property
  SELECT p.id
  FROM public.properties p
  JOIN public.owner_entity_members oem ON oem.owner_id = p.owner_id
  WHERE oem.user_id = p_user_id;
$$;

COMMENT ON FUNCTION public.user_property_ids(uuid) IS
  'Returns the set of property IDs visible to a user. Used by every property-scoped RLS policy. STABLE so PG caches it per statement.';


-- ============================================================================
-- 2. user_can_manage_property(p_property_id) — write authorization
--
-- True for: Admin, or property_access row with access_level = 'Property Manager'
-- Used in WITH CHECK clauses on property-scoped tables that allow writes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_can_manage_property(
  p_property_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    -- Admin shortcut
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND role = 'Admin' AND COALESCE(is_active, true)
    )
    OR
    -- Property Manager grant
    EXISTS (
      SELECT 1 FROM public.property_access
      WHERE user_id = p_user_id
        AND property_id = p_property_id
        AND access_level = 'Property Manager'
        AND (expires_at IS NULL OR expires_at > now())
    );
$$;

COMMENT ON FUNCTION public.user_can_manage_property(uuid, uuid) IS
  'True if the user can write/edit data for this property (Admin or Property Manager grant).';


-- ============================================================================
-- 3. user_can_view_property_financials(p_property_id) — financial-read auth
--
-- True for: Admin, any property_access grant on the property (Property Manager,
-- Accounting full, Accounting read, Owner), and owner_entity_member of the
-- property's owner.
-- Used by RLS on transactions, accounting, distributions, etc.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_can_view_property_financials(
  p_property_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    -- Admin shortcut
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND role = 'Admin' AND COALESCE(is_active, true)
    )
    OR
    -- Any property_access grant grants financial-read (manager, both accounting, owner_viewer)
    EXISTS (
      SELECT 1 FROM public.property_access
      WHERE user_id = p_user_id
        AND property_id = p_property_id
        AND (expires_at IS NULL OR expires_at > now())
    )
    OR
    -- Owner entity members see their entities' properties
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.owner_entity_members oem ON oem.owner_id = p.owner_id
      WHERE p.id = p_property_id AND oem.user_id = p_user_id
    );
$$;

COMMENT ON FUNCTION public.user_can_view_property_financials(uuid, uuid) IS
  'True if the user can read $ data for this property. Superset of user_can_manage_property — any grant + owner membership counts.';


-- ============================================================================
-- 4. user_can_post_financials(p_property_id) — financial-write auth
--
-- True for: Admin, Property Manager, or Accounting (with permission_tier = 'full').
-- Accounting (read) and Owner cannot post.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_can_post_financials(
  p_property_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    -- Admin shortcut
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = p_user_id AND role = 'Admin' AND COALESCE(is_active, true)
    )
    OR
    -- Property Manager OR Accounting (full tier)
    EXISTS (
      SELECT 1 FROM public.property_access
      WHERE user_id = p_user_id
        AND property_id = p_property_id
        AND (
          access_level = 'Property Manager'
          OR (access_level = 'Accounting' AND permission_tier = 'full')
        )
        AND (expires_at IS NULL OR expires_at > now())
    );
$$;

COMMENT ON FUNCTION public.user_can_post_financials(uuid, uuid) IS
  'True if the user can post charges/payments/transactions on this property (Admin, Property Manager, or Accounting/full).';


-- ============================================================================
-- 5. user_property_access_level(p_property_id) — diagnostic / UI helper
--
-- Returns the highest-precedence access label the user has on the property,
-- or NULL if no access. Precedence (highest first):
--   'Admin' → 'Property Manager' → 'Accounting (full)' → 'Accounting (read)' →
--   'Owner' → 'Owner Member' (via owner_entity_members)
--
-- Labels match the user-roles dropdown for UI consistency. Use this in the
-- frontend to render different controls per access level.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.user_property_access_level(
  p_property_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_role   text;
  v_level  text;
  v_tier   text;
BEGIN
  -- Admin shortcut
  SELECT role INTO v_role
  FROM public.profiles
  WHERE id = p_user_id AND COALESCE(is_active, true);

  IF v_role = 'Admin' THEN
    RETURN 'Admin';
  END IF;

  -- property_access — highest-precedence non-admin grant
  SELECT access_level, permission_tier INTO v_level, v_tier
  FROM public.property_access
  WHERE user_id = p_user_id
    AND property_id = p_property_id
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY
    CASE access_level
      WHEN 'Property Manager' THEN 1
      WHEN 'Accounting'       THEN CASE WHEN permission_tier = 'full' THEN 2 ELSE 3 END
      WHEN 'Owner'            THEN 4
    END
  LIMIT 1;

  IF v_level IS NOT NULL THEN
    IF v_level = 'Accounting' THEN
      RETURN 'Accounting (' || v_tier || ')';
    END IF;
    RETURN v_level;
  END IF;

  -- Owner entity membership (Option B path for cross-owner viewing)
  IF EXISTS (
    SELECT 1
    FROM public.properties p
    JOIN public.owner_entity_members oem ON oem.owner_id = p.owner_id
    WHERE p.id = p_property_id AND oem.user_id = p_user_id
  ) THEN
    RETURN 'Owner Member';
  END IF;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.user_property_access_level(uuid, uuid) IS
  'Returns the highest-precedence access label for a user on a property, or NULL. Labels: "Admin", "Property Manager", "Accounting (full)", "Accounting (read)", "Owner", "Owner Member". For UI rendering.';


-- ============================================================================
-- 6. Grants — these helpers are called by RLS policies, so they must be
-- callable by all authenticated users.
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.user_property_ids(uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.user_can_manage_property(uuid, uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.user_can_view_property_financials(uuid, uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.user_can_post_financials(uuid, uuid)
  TO authenticated;

GRANT EXECUTE ON FUNCTION public.user_property_access_level(uuid, uuid)
  TO authenticated;

COMMIT;
