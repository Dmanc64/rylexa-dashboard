-- ============================================================================
-- Migration 072: Audit triggers on property_access + owner_entity_members
--
-- Every grant, revoke, or modification of a property assignment is now logged
-- to public.audit_log automatically. Captures:
--   - which row changed (record_id)
--   - what changed (old_values / new_values as JSON diffs)
--   - who did it (user_id, user_email, user_role)
--   - when (created_at)
--
-- This gives you a tamper-resistant audit trail for "who gave PM Bob access
-- to Property X on May 6th" — important for compliance and for chasing down
-- mistaken revocations.
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. Generic trigger function — log to audit_log
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_audit_property_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text;
  v_role   text;
  v_record uuid;
BEGIN
  -- Capture the actor's email + role (best-effort — server-side actions may
  -- run as service role, in which case auth.uid() is null and we record NULL).
  IF v_uid IS NOT NULL THEN
    SELECT au.email, p.role
      INTO v_email, v_role
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.id = au.id
    WHERE au.id = v_uid;
  END IF;

  -- record_id is NEW.id for insert/update, OLD.id for delete
  v_record := COALESCE(NEW.id, OLD.id);

  INSERT INTO public.audit_log
    (table_name, record_id, action, old_values, new_values, user_id, user_email, user_role)
  VALUES
    (
      TG_TABLE_NAME,
      v_record,
      TG_OP,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      CASE WHEN TG_OP IN ('UPDATE', 'INSERT') THEN to_jsonb(NEW) ELSE NULL END,
      v_uid,
      v_email,
      v_role
    );

  -- Triggers must return the row; for AFTER triggers it's ignored, but
  -- returning NEW (or OLD on delete) keeps the function well-behaved.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fn_audit_property_access() IS
  'Generic audit trigger for property_access and owner_entity_members. Logs every INSERT/UPDATE/DELETE to public.audit_log with actor details.';


-- ============================================================================
-- 2. Triggers — property_access
-- ============================================================================

DROP TRIGGER IF EXISTS trg_audit_property_access_iud ON public.property_access;

CREATE TRIGGER trg_audit_property_access_iud
  AFTER INSERT OR UPDATE OR DELETE ON public.property_access
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_property_access();


-- ============================================================================
-- 3. Triggers — owner_entity_members
-- ============================================================================

DROP TRIGGER IF EXISTS trg_audit_owner_entity_members_iud ON public.owner_entity_members;

CREATE TRIGGER trg_audit_owner_entity_members_iud
  AFTER INSERT OR UPDATE OR DELETE ON public.owner_entity_members
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_audit_property_access();

COMMIT;
