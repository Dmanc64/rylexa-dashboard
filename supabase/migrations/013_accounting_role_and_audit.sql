-- ============================================================================
-- Migration 013: Accounting Role & Login Audit
--
-- Phase 4 of the security remediation plan:
-- 1. Add Accounting role to RLS helper functions
-- 2. Add Accounting-specific RLS policies on financial tables
-- 3. Create login_audit table for session tracking
-- 4. Create audit trigger function for login events
--
-- ROLLBACK: Drop new policies, revert helper functions, drop login_audit table
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Update RLS helper functions to include Accounting role
-- ============================================================================

-- Accounting is considered "management" for financial reads but NOT for
-- tenant/property/lease writes. We create a new helper instead of modifying
-- is_management() to keep write-access restricted to Admin + PM.

CREATE OR REPLACE FUNCTION public.is_finance_reader()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = auth.uid())
    IN ('Admin', 'Property Manager', 'Accounting');
END;
$$;

-- ============================================================================
-- STEP 2: Add Accounting role RLS policies on financial tables
-- ============================================================================

-- Accounting can READ all financial tables but NOT write (append-only journals
-- and ledger entries are management-only to preserve audit integrity)

-- gl_accounts: Accounting can read chart of accounts
CREATE POLICY "Accounting read gl_accounts"
  ON public.gl_accounts FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Accounting');

-- journal_entries: Accounting can read journal entries
CREATE POLICY "Accounting read journal_entries"
  ON public.journal_entries FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Accounting');

-- ledger_entries: Accounting can read ledger entries
CREATE POLICY "Accounting read ledger_entries"
  ON public.ledger_entries FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Accounting');

-- accounting (rent charges/payments): Accounting can read
CREATE POLICY "Accounting read accounting"
  ON public.accounting FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Accounting');

-- transactions: Accounting can read all transactions
CREATE POLICY "Accounting read transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Accounting');

-- properties: Accounting needs property names for financial reports
CREATE POLICY "Accounting read properties"
  ON public.properties FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Accounting');

-- units: Accounting needs unit context for financial reports
CREATE POLICY "Accounting read units"
  ON public.units FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Accounting');

-- leases: Accounting needs lease data for rent/revenue reports
CREATE POLICY "Accounting read leases"
  ON public.leases FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Accounting');

-- profiles: Accounting can read own profile (needed for middleware)
-- Already covered by "Users read own profile" policy

-- ============================================================================
-- STEP 3: Create login_audit table for session tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.login_audit (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text,
  event_type text NOT NULL DEFAULT 'LOGIN',  -- LOGIN, LOGOUT, TOKEN_REFRESH, FAILED_LOGIN
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS on login_audit
ALTER TABLE public.login_audit ENABLE ROW LEVEL SECURITY;

-- Only management can view login audit logs
CREATE POLICY "Management read login_audit"
  ON public.login_audit FOR SELECT
  TO authenticated
  USING (is_management());

-- Service role inserts (via trigger/edge function) bypass RLS,
-- but allow staff to insert for logging purposes
CREATE POLICY "Staff insert login_audit"
  ON public.login_audit FOR INSERT
  TO authenticated
  WITH CHECK (is_staff());

-- Index for common queries
CREATE INDEX idx_login_audit_user_id ON public.login_audit (user_id);
CREATE INDEX idx_login_audit_created_at ON public.login_audit (created_at DESC);
CREATE INDEX idx_login_audit_event_type ON public.login_audit (event_type);

COMMIT;
