-- 055: Comprehensive audit trail with automatic trigger-based capture
-- Tracks INSERT/UPDATE/DELETE on key tables with before/after values

BEGIN;

-- ============================================================
-- 1. AUDIT_LOG TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id  uuid,
  action     text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_values jsonb,
  new_values jsonb,
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  user_email text,
  user_role  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX idx_audit_log_created_at ON public.audit_log (created_at DESC);
CREATE INDEX idx_audit_log_table_record ON public.audit_log (table_name, record_id);
CREATE INDEX idx_audit_log_user_id ON public.audit_log (user_id);
CREATE INDEX idx_audit_log_action ON public.audit_log (action);

-- ============================================================
-- 2. RLS — Admin-only read access
-- ============================================================
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read audit_log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.get_my_role() = 'Admin');

-- No INSERT/UPDATE/DELETE policies for users — trigger uses SECURITY DEFINER

-- ============================================================
-- 3. GENERIC TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION public.audit_trigger_func()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old       jsonb;
  v_new       jsonb;
  v_diff_old  jsonb;
  v_diff_new  jsonb;
  v_record_id uuid;
  v_user_id   uuid;
  v_email     text;
  v_role      text;
  k           text;
BEGIN
  -- Capture current user (may be NULL for service-role operations)
  v_user_id := auth.uid();

  -- Best-effort user info lookup
  IF v_user_id IS NOT NULL THEN
    SELECT p.email, p.role INTO v_email, v_role
    FROM public.profiles p WHERE p.id = v_user_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    v_record_id := NEW.id;

    INSERT INTO public.audit_log(table_name, record_id, action, new_values, user_id, user_email, user_role)
    VALUES (TG_TABLE_NAME, v_record_id, 'INSERT', v_new, v_user_id, v_email, v_role);

    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);

    -- Only store columns that actually changed
    v_diff_old := '{}';
    v_diff_new := '{}';

    FOR k IN SELECT jsonb_object_keys(v_new)
    LOOP
      IF v_old ->> k IS DISTINCT FROM v_new ->> k THEN
        v_diff_old := v_diff_old || jsonb_build_object(k, v_old -> k);
        v_diff_new := v_diff_new || jsonb_build_object(k, v_new -> k);
      END IF;
    END LOOP;

    -- Skip if nothing actually changed
    IF v_diff_new = '{}'::jsonb THEN
      RETURN NEW;
    END IF;

    v_record_id := NEW.id;

    INSERT INTO public.audit_log(table_name, record_id, action, old_values, new_values, user_id, user_email, user_role)
    VALUES (TG_TABLE_NAME, v_record_id, 'UPDATE', v_diff_old, v_diff_new, v_user_id, v_email, v_role);

    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    v_record_id := OLD.id;

    INSERT INTO public.audit_log(table_name, record_id, action, old_values, user_id, user_email, user_role)
    VALUES (TG_TABLE_NAME, v_record_id, 'DELETE', v_old, v_user_id, v_email, v_role);

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- ============================================================
-- 4. ATTACH TRIGGERS TO KEY TABLES
-- ============================================================

CREATE TRIGGER audit_leases
  AFTER INSERT OR UPDATE OR DELETE ON public.leases
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_work_orders
  AFTER INSERT OR UPDATE OR DELETE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_tenants
  AFTER INSERT OR UPDATE OR DELETE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_units
  AFTER INSERT OR UPDATE OR DELETE ON public.units
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_properties
  AFTER INSERT OR UPDATE OR DELETE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_vendors
  AFTER INSERT OR UPDATE OR DELETE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_profiles
  AFTER INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_accounting
  AFTER INSERT OR UPDATE OR DELETE ON public.accounting
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_transactions
  AFTER INSERT OR UPDATE OR DELETE ON public.transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_vendor_bids
  AFTER INSERT OR UPDATE OR DELETE ON public.vendor_bids
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER audit_vendor_invoices
  AFTER INSERT OR UPDATE OR DELETE ON public.vendor_invoices
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

COMMIT;
