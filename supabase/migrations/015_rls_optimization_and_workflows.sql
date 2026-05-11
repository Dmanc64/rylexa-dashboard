-- ============================================================================
-- Migration 015: RLS Optimization & Backend Workflows
--
-- Phase 6 of the security remediation plan:
-- 1. Add get_my_vendor_id() / get_my_tenant_ids() helpers (SECURITY DEFINER)
--    to cache expensive subqueries that repeat across 13 Vendor/Tenant policies
-- 2. Rewrite 18 RLS policies to use (select auth.uid()) initplan wrapper
--    so Postgres evaluates the UID once per query instead of per-row
-- 3. Create get_delinquent_tenants() RPC for late-fee automation
-- 4. Create post_late_fee() RPC for double-entry ledger late fees
-- 5. Add missing leases.tenant_id single-column index (last FK warning)
--
-- ROLLBACK: Reverse policy rewrites; DROP the new functions/indexes
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: New helper functions (SECURITY DEFINER to bypass RLS recursion)
-- ============================================================================

-- Returns the vendor.id for the currently authenticated user (matched by email)
-- Returns NULL if the user is not a vendor.
-- SECURITY DEFINER so it can read vendors table without triggering RLS.
CREATE OR REPLACE FUNCTION public.get_my_vendor_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT v.id
  FROM public.vendors v
  WHERE lower(v.email) = lower(
    (SELECT u.email FROM auth.users u WHERE u.id = (select auth.uid()))
  )
  LIMIT 1;
$$;

-- Returns the tenant IDs linked to the current user via leases.
-- A user might have multiple leases (current + past), so returns a set.
-- SECURITY DEFINER so it can read leases/tenants without triggering RLS.
CREATE OR REPLACE FUNCTION public.get_my_tenant_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT l.tenant_id
  FROM public.leases l
  WHERE l.user_id = (select auth.uid());
$$;

-- Also update existing helpers to use (select auth.uid()) wrapper
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = (select auth.uid());
  RETURN COALESCE(v_role, '');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = (select auth.uid()))
    IN ('Admin', 'Property Manager', 'Maintenance');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_management()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = (select auth.uid()))
    IN ('Admin', 'Property Manager');
END;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = (select auth.uid())) = 'Admin';
END;
$$;

CREATE OR REPLACE FUNCTION public.is_finance_reader()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = (select auth.uid()))
    IN ('Admin', 'Property Manager', 'Accounting');
END;
$$;


-- ============================================================================
-- STEP 2: Rewrite RLS policies with (select auth.uid()) + new helpers
-- Drop and recreate only the policies that reference auth.uid() directly
-- ============================================================================

-- ─── PROFILES ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);


-- ─── PROPERTIES ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Tenants read own property" ON public.properties;
CREATE POLICY "Tenants read own property"
  ON public.properties FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND id IN (
      SELECT p.id FROM public.properties p
      JOIN public.units u ON u.property_id = p.id
      JOIN public.leases l ON l.unit_id = u.id
      WHERE l.user_id = (select auth.uid()) AND l.status = 'Active'
    )
  );

DROP POLICY IF EXISTS "Vendors read assigned properties" ON public.properties;
CREATE POLICY "Vendors read assigned properties"
  ON public.properties FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND id IN (
      SELECT p.id FROM public.properties p
      JOIN public.units u ON u.property_id = p.id
      JOIN public.work_orders wo ON wo.unit_id = u.id
      WHERE wo.vendor_id = (select get_my_vendor_id())
    )
  );


-- ─── UNITS ──────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Tenants read own unit" ON public.units;
CREATE POLICY "Tenants read own unit"
  ON public.units FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND id IN (
      SELECT l.unit_id FROM public.leases l
      WHERE l.user_id = (select auth.uid()) AND l.status = 'Active'
    )
  );

DROP POLICY IF EXISTS "Vendors read assigned units" ON public.units;
CREATE POLICY "Vendors read assigned units"
  ON public.units FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND id IN (
      SELECT wo.unit_id FROM public.work_orders wo
      WHERE wo.vendor_id = (select get_my_vendor_id())
    )
  );


-- ─── TENANTS ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Tenants read own record" ON public.tenants;
CREATE POLICY "Tenants read own record"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND id IN (select get_my_tenant_ids())
  );


-- ─── LEASES ─────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Tenants read own lease" ON public.leases;
CREATE POLICY "Tenants read own lease"
  ON public.leases FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND user_id = (select auth.uid())
  );


-- ─── WORK_ORDERS ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Vendors read assigned work_orders" ON public.work_orders;
CREATE POLICY "Vendors read assigned work_orders"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id = (select get_my_vendor_id())
  );

DROP POLICY IF EXISTS "Vendors update assigned work_orders" ON public.work_orders;
CREATE POLICY "Vendors update assigned work_orders"
  ON public.work_orders FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id = (select get_my_vendor_id())
  )
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND vendor_id = (select get_my_vendor_id())
  );

DROP POLICY IF EXISTS "Tenants read own work_orders" ON public.work_orders;
CREATE POLICY "Tenants read own work_orders"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND tenant_id IN (select get_my_tenant_ids())
  );


-- ─── WORK_ORDER_UPDATES ────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Vendors read assigned wo_updates" ON public.work_order_updates;
CREATE POLICY "Vendors read assigned wo_updates"
  ON public.work_order_updates FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.vendor_id = (select get_my_vendor_id())
    )
  );

DROP POLICY IF EXISTS "Vendors insert wo_updates" ON public.work_order_updates;
CREATE POLICY "Vendors insert wo_updates"
  ON public.work_order_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.vendor_id = (select get_my_vendor_id())
    )
  );

DROP POLICY IF EXISTS "Tenants read own wo_updates" ON public.work_order_updates;
CREATE POLICY "Tenants read own wo_updates"
  ON public.work_order_updates FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND work_order_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.tenant_id IN (select get_my_tenant_ids())
    )
  );


-- ─── VENDORS ────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Vendors read own record" ON public.vendors;
CREATE POLICY "Vendors read own record"
  ON public.vendors FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND id = (select get_my_vendor_id())
  );


-- ─── ACCOUNTING ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Tenants read own accounting" ON public.accounting;
CREATE POLICY "Tenants read own accounting"
  ON public.accounting FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND lease_id IN (
      SELECT l.id FROM public.leases l WHERE l.user_id = (select auth.uid())
    )
  );


-- ─── TRANSACTIONS ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Vendors read own transactions" ON public.transactions;
CREATE POLICY "Vendors read own transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id = (select get_my_vendor_id())
  );


-- ─── SYSTEM_ACTIVITY ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Vendors read own system_activity" ON public.system_activity;
CREATE POLICY "Vendors read own system_activity"
  ON public.system_activity FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND related_entity_id IN (
      SELECT wo.id FROM public.work_orders wo
      WHERE wo.vendor_id = (select get_my_vendor_id())
    )
  );


-- ============================================================================
-- STEP 3: Accounting workflow RPCs
-- ============================================================================

-- get_delinquent_tenants: Find tenants with outstanding balance (rent charged but
-- total payments < total charges). Called by the apply-late-fees edge function.
-- Returns: tenant id, name, lease_id, balance_due
CREATE OR REPLACE FUNCTION public.get_delinquent_tenants()
RETURNS TABLE (
  id uuid,
  first_name text,
  last_name text,
  lease_id uuid,
  total_charges numeric,
  total_payments numeric,
  balance_due numeric
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT
    t.id,
    t.first_name,
    t.last_name,
    l.id AS lease_id,
    COALESCE(SUM(CASE WHEN a.type IN ('Rent Charge', 'Late Fee') THEN a.amount ELSE 0 END), 0) AS total_charges,
    COALESCE(SUM(CASE WHEN a.type = 'Payment' THEN a.amount ELSE 0 END), 0) AS total_payments,
    COALESCE(SUM(CASE WHEN a.type IN ('Rent Charge', 'Late Fee') THEN a.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN a.type = 'Payment' THEN a.amount ELSE 0 END), 0) AS balance_due
  FROM public.tenants t
  JOIN public.leases l ON l.tenant_id = t.id AND l.status = 'Active'
  LEFT JOIN public.accounting a ON a.lease_id = l.id AND a.status = 'Posted'
  WHERE t.status = 'Active'
  GROUP BY t.id, t.first_name, t.last_name, l.id
  HAVING
    COALESCE(SUM(CASE WHEN a.type IN ('Rent Charge', 'Late Fee') THEN a.amount ELSE 0 END), 0)
    - COALESCE(SUM(CASE WHEN a.type = 'Payment' THEN a.amount ELSE 0 END), 0) > 0;
$$;


-- post_late_fee: Insert a late fee into accounting (tenant-facing ledger) AND
-- create a double-entry journal entry (GL). Called by apply-late-fees edge function.
-- Uses GL accounts: 1100 (Accounts Receivable DR) / 4100 (Late Fee Income CR)
CREATE OR REPLACE FUNCTION public.post_late_fee(
  t_id uuid,
  amount numeric,
  "desc" text DEFAULT 'Late Fee'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_lease_id uuid;
  v_je_id uuid;
  v_ar_account uuid;
  v_fee_account uuid;
BEGIN
  -- 1. Get the active lease for this tenant
  SELECT l.id INTO v_lease_id
  FROM public.leases l
  WHERE l.tenant_id = t_id AND l.status = 'Active'
  LIMIT 1;

  IF v_lease_id IS NULL THEN
    RAISE EXCEPTION 'No active lease found for tenant %', t_id;
  END IF;

  -- 2. Look up GL account IDs
  SELECT id INTO v_ar_account FROM public.gl_accounts WHERE code = '1100';
  SELECT id INTO v_fee_account FROM public.gl_accounts WHERE code = '4100';

  IF v_ar_account IS NULL OR v_fee_account IS NULL THEN
    RAISE EXCEPTION 'Required GL accounts (1100, 4100) not found';
  END IF;

  -- 3. Insert into accounting (tenant-facing ledger)
  INSERT INTO public.accounting (type, category, description, amount, lease_id, status)
  VALUES ('Late Fee', 'Late Fee', "desc", amount, v_lease_id, 'Posted');

  -- 4. Create journal entry (double-entry audit trail)
  INSERT INTO public.journal_entries (description, reference_id, entry_type)
  VALUES ("desc", v_lease_id, 'LATE_FEE')
  RETURNING id INTO v_je_id;

  -- 5. Debit Accounts Receivable (tenant owes more)
  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_ar_account, amount, 0);

  -- 6. Credit Late Fee Income (revenue recognized)
  INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
  VALUES (v_je_id, v_fee_account, 0, amount);
END;
$$;


-- ============================================================================
-- STEP 4: Missing FK index
-- ============================================================================

-- leases.tenant_id — the unique composite index (unit_id, tenant_id) exists but
-- Postgres cannot use it for lookups by tenant_id alone (it's the 2nd column).
-- This covers cascading DELETEs from tenants and RLS subqueries.
CREATE INDEX IF NOT EXISTS idx_leases_tenant_id ON public.leases (tenant_id);


COMMIT;
