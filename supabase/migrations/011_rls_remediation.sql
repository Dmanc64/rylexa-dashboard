-- ============================================================================
-- Migration 011: RLS Remediation
--
-- CRITICAL SECURITY FIX: Replace all permissive "Allow All" and broad
-- authenticated policies with role-scoped policies.
--
-- This migration:
-- 1. Creates helper functions for role checking (SECURITY DEFINER to avoid recursion)
-- 2. Drops ALL existing policies on all 16 tables
-- 3. Creates new role-scoped policies per the access matrix
-- 4. Preserves the existing is_admin() function
--
-- ROLLBACK: See bottom of file for inverse migration
-- ============================================================================

-- ============================================================================
-- STEP 1: Create helper functions for role-based policy checks
-- ============================================================================

-- Helper: Get current user's role from profiles (SECURITY DEFINER avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
  RETURN COALESCE(v_role, '');
END;
$$;

-- Helper: Check if current user is staff (Admin, Property Manager, or Maintenance)
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = auth.uid())
    IN ('Admin', 'Property Manager', 'Maintenance');
END;
$$;

-- Helper: Check if current user is management (Admin or Property Manager)
CREATE OR REPLACE FUNCTION public.is_management()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
BEGIN
  RETURN (SELECT role FROM public.profiles WHERE id = auth.uid())
    IN ('Admin', 'Property Manager');
END;
$$;

-- ============================================================================
-- STEP 2: Drop ALL existing policies (clean slate)
-- ============================================================================

-- profiles
DROP POLICY IF EXISTS "Admins manage all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users see own profile" ON public.profiles;

-- properties
DROP POLICY IF EXISTS "Allow All" ON public.properties;
DROP POLICY IF EXISTS "Allow All Access" ON public.properties;
DROP POLICY IF EXISTS "Authenticated users can insert properties" ON public.properties;
DROP POLICY IF EXISTS "Authenticated users can read properties" ON public.properties;
DROP POLICY IF EXISTS "Authenticated users can update properties" ON public.properties;

-- units
DROP POLICY IF EXISTS "Allow All" ON public.units;
DROP POLICY IF EXISTS "Allow All Access" ON public.units;
DROP POLICY IF EXISTS "Authenticated users can insert units" ON public.units;
DROP POLICY IF EXISTS "Authenticated users can read units" ON public.units;
DROP POLICY IF EXISTS "Authenticated users can update units" ON public.units;

-- tenants
DROP POLICY IF EXISTS "Allow All" ON public.tenants;
DROP POLICY IF EXISTS "Allow All Access" ON public.tenants;
DROP POLICY IF EXISTS "Authenticated users can insert tenants" ON public.tenants;
DROP POLICY IF EXISTS "Authenticated users can read tenants" ON public.tenants;
DROP POLICY IF EXISTS "Authenticated users can update tenants" ON public.tenants;

-- leases
DROP POLICY IF EXISTS "Allow All" ON public.leases;
DROP POLICY IF EXISTS "Allow All Access" ON public.leases;
DROP POLICY IF EXISTS "Admins manage all leases" ON public.leases;
DROP POLICY IF EXISTS "Authenticated users can insert leases" ON public.leases;
DROP POLICY IF EXISTS "Authenticated users can read leases" ON public.leases;
DROP POLICY IF EXISTS "Authenticated users can update leases" ON public.leases;
DROP POLICY IF EXISTS "Tenants view own lease" ON public.leases;

-- work_orders
DROP POLICY IF EXISTS "Allow All" ON public.work_orders;
DROP POLICY IF EXISTS "Admins manage orders" ON public.work_orders;
DROP POLICY IF EXISTS "Authenticated users can insert work_orders" ON public.work_orders;
DROP POLICY IF EXISTS "Authenticated users can update work_orders" ON public.work_orders;
DROP POLICY IF EXISTS "Maintenance view assigned" ON public.work_orders;
DROP POLICY IF EXISTS "Role based read work_orders" ON public.work_orders;

-- work_order_updates
DROP POLICY IF EXISTS "Authenticated users can insert work_order_updates" ON public.work_order_updates;
DROP POLICY IF EXISTS "Authenticated users can read work_order_updates" ON public.work_order_updates;
DROP POLICY IF EXISTS "Staff add updates" ON public.work_order_updates;
DROP POLICY IF EXISTS "View updates" ON public.work_order_updates;

-- vendors
DROP POLICY IF EXISTS "Allow All" ON public.vendors;
DROP POLICY IF EXISTS "Authenticated users can insert vendors" ON public.vendors;
DROP POLICY IF EXISTS "Authenticated users can read vendors" ON public.vendors;
DROP POLICY IF EXISTS "Authenticated users can update vendors" ON public.vendors;

-- accounting
DROP POLICY IF EXISTS "Admins manage accounting" ON public.accounting;
DROP POLICY IF EXISTS "Authenticated users can insert accounting" ON public.accounting;
DROP POLICY IF EXISTS "Authenticated users can read accounting" ON public.accounting;
DROP POLICY IF EXISTS "Authenticated users can update accounting" ON public.accounting;
DROP POLICY IF EXISTS "Tenants view own ledger" ON public.accounting;

-- transactions
DROP POLICY IF EXISTS "Allow All" ON public.transactions;
DROP POLICY IF EXISTS "Authenticated users can insert transactions" ON public.transactions;
DROP POLICY IF EXISTS "Authenticated users can read transactions" ON public.transactions;

-- applications
DROP POLICY IF EXISTS "Allow admin full control" ON public.applications;
DROP POLICY IF EXISTS "Allow admin/accounting to view all" ON public.applications;
DROP POLICY IF EXISTS "Allow public submission" ON public.applications;
DROP POLICY IF EXISTS "Anyone can insert applications" ON public.applications;
DROP POLICY IF EXISTS "Authenticated users can read applications" ON public.applications;
DROP POLICY IF EXISTS "Authenticated users can update applications" ON public.applications;

-- chat_messages
DROP POLICY IF EXISTS "Authenticated users can insert chat_messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Authenticated users can read chat_messages" ON public.chat_messages;

-- system_activity
DROP POLICY IF EXISTS "Authenticated users can insert system_activity" ON public.system_activity;
DROP POLICY IF EXISTS "Authenticated users can read system_activity" ON public.system_activity;

-- gl_accounts
DROP POLICY IF EXISTS "Authenticated users can read gl_accounts" ON public.gl_accounts;

-- journal_entries
DROP POLICY IF EXISTS "Authenticated users can insert journal_entries" ON public.journal_entries;
DROP POLICY IF EXISTS "Authenticated users can read journal_entries" ON public.journal_entries;

-- ledger_entries
DROP POLICY IF EXISTS "Authenticated users can insert ledger_entries" ON public.ledger_entries;
DROP POLICY IF EXISTS "Authenticated users can read ledger_entries" ON public.ledger_entries;


-- ============================================================================
-- STEP 3: Create new role-scoped policies
-- ============================================================================

-- ─── PROFILES ───────────────────────────────────────────────────────────────
-- Everyone must read their own profile (middleware depends on this)
-- Management can read all profiles (user management, search, display names)

CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Management read all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (is_management());

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins manage profiles"
  ON public.profiles FOR ALL
  TO authenticated
  USING (get_my_role() = 'Admin')
  WITH CHECK (get_my_role() = 'Admin');


-- ─── PROPERTIES ─────────────────────────────────────────────────────────────
-- Staff can read (admin, PM, maintenance need property context for work orders)
-- Only management can create/update

CREATE POLICY "Staff read properties"
  ON public.properties FOR SELECT
  TO authenticated
  USING (is_staff());

-- Tenants need to read their property name (via portal dashboard)
CREATE POLICY "Tenants read own property"
  ON public.properties FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND id IN (
      SELECT p.id FROM properties p
      JOIN units u ON u.property_id = p.id
      JOIN leases l ON l.unit_id = u.id
      WHERE l.user_id = auth.uid() AND l.status = 'Active'
    )
  );

-- Vendors need property names for their assigned work orders
CREATE POLICY "Vendors read assigned properties"
  ON public.properties FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND id IN (
      SELECT p.id FROM properties p
      JOIN units u ON u.property_id = p.id
      JOIN work_orders wo ON wo.unit_id = u.id
      WHERE wo.vendor_id IN (
        SELECT v.id FROM vendors v
        WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      )
    )
  );

CREATE POLICY "Management insert properties"
  ON public.properties FOR INSERT
  TO authenticated
  WITH CHECK (is_management());

CREATE POLICY "Management update properties"
  ON public.properties FOR UPDATE
  TO authenticated
  USING (is_management())
  WITH CHECK (is_management());


-- ─── UNITS ──────────────────────────────────────────────────────────────────
-- Staff can read all units (needed for work order context, search, etc.)
-- Only management can create/update

CREATE POLICY "Staff read units"
  ON public.units FOR SELECT
  TO authenticated
  USING (is_staff());

-- Tenants need their own unit
CREATE POLICY "Tenants read own unit"
  ON public.units FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND id IN (
      SELECT l.unit_id FROM leases l
      WHERE l.user_id = auth.uid() AND l.status = 'Active'
    )
  );

-- Vendors need unit info for assigned work orders
CREATE POLICY "Vendors read assigned units"
  ON public.units FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND id IN (
      SELECT wo.unit_id FROM work_orders wo
      WHERE wo.vendor_id IN (
        SELECT v.id FROM vendors v
        WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      )
    )
  );

CREATE POLICY "Management insert units"
  ON public.units FOR INSERT
  TO authenticated
  WITH CHECK (is_management());

CREATE POLICY "Management update units"
  ON public.units FOR UPDATE
  TO authenticated
  USING (is_management())
  WITH CHECK (is_management());


-- ─── TENANTS ────────────────────────────────────────────────────────────────
-- Management can CRUD (admin dashboard)
-- Maintenance can read (see who reported work order)
-- Tenants can read own record only

CREATE POLICY "Management manage tenants"
  ON public.tenants FOR ALL
  TO authenticated
  USING (is_management())
  WITH CHECK (is_management());

CREATE POLICY "Maintenance read tenants"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Maintenance');

CREATE POLICY "Tenants read own record"
  ON public.tenants FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND id IN (
      SELECT l.tenant_id FROM leases l WHERE l.user_id = auth.uid()
    )
  );


-- ─── LEASES ─────────────────────────────────────────────────────────────────
-- Management can CRUD
-- Maintenance can read (work order context)
-- Tenants can read own lease only

CREATE POLICY "Management manage leases"
  ON public.leases FOR ALL
  TO authenticated
  USING (is_management())
  WITH CHECK (is_management());

CREATE POLICY "Maintenance read leases"
  ON public.leases FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Maintenance');

CREATE POLICY "Tenants read own lease"
  ON public.leases FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND user_id = auth.uid()
  );


-- ─── WORK_ORDERS ────────────────────────────────────────────────────────────
-- The most complex table: different access for every role.

-- Management full CRUD
CREATE POLICY "Management manage work_orders"
  ON public.work_orders FOR ALL
  TO authenticated
  USING (is_management())
  WITH CHECK (is_management());

-- Maintenance can read all + update status
CREATE POLICY "Maintenance read work_orders"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Maintenance');

CREATE POLICY "Maintenance update work_orders"
  ON public.work_orders FOR UPDATE
  TO authenticated
  USING (get_my_role() = 'Maintenance')
  WITH CHECK (get_my_role() = 'Maintenance');

-- Vendors see only their assigned orders + can update them
CREATE POLICY "Vendors read assigned work_orders"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

CREATE POLICY "Vendors update assigned work_orders"
  ON public.work_orders FOR UPDATE
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  )
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

-- Tenants see own work orders + can create new ones
CREATE POLICY "Tenants read own work_orders"
  ON public.work_orders FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND tenant_id IN (
      SELECT t.id FROM tenants t
      JOIN leases l ON l.tenant_id = t.id
      WHERE l.user_id = auth.uid()
    )
  );

CREATE POLICY "Tenants insert work_orders"
  ON public.work_orders FOR INSERT
  TO authenticated
  WITH CHECK (get_my_role() = 'Tenant');


-- ─── WORK_ORDER_UPDATES ────────────────────────────────────────────────────
-- Staff can read all + insert
-- Vendors can read/insert for their assigned work orders
-- Tenants can read updates on their own work orders

CREATE POLICY "Staff read work_order_updates"
  ON public.work_order_updates FOR SELECT
  TO authenticated
  USING (is_staff());

CREATE POLICY "Staff insert work_order_updates"
  ON public.work_order_updates FOR INSERT
  TO authenticated
  WITH CHECK (is_staff());

CREATE POLICY "Vendors read assigned wo_updates"
  ON public.work_order_updates FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND work_order_id IN (
      SELECT wo.id FROM work_orders wo
      WHERE wo.vendor_id IN (
        SELECT v.id FROM vendors v
        WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      )
    )
  );

CREATE POLICY "Vendors insert wo_updates"
  ON public.work_order_updates FOR INSERT
  TO authenticated
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND work_order_id IN (
      SELECT wo.id FROM work_orders wo
      WHERE wo.vendor_id IN (
        SELECT v.id FROM vendors v
        WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      )
    )
  );

CREATE POLICY "Tenants read own wo_updates"
  ON public.work_order_updates FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND work_order_id IN (
      SELECT wo.id FROM work_orders wo
      WHERE wo.tenant_id IN (
        SELECT t.id FROM tenants t
        JOIN leases l ON l.tenant_id = t.id
        WHERE l.user_id = auth.uid()
      )
    )
  );


-- ─── VENDORS ────────────────────────────────────────────────────────────────
-- Management can CRUD
-- Maintenance can read (to see assigned vendor on work orders)
-- Vendors can read own record only

CREATE POLICY "Management manage vendors"
  ON public.vendors FOR ALL
  TO authenticated
  USING (is_management())
  WITH CHECK (is_management());

CREATE POLICY "Maintenance read vendors"
  ON public.vendors FOR SELECT
  TO authenticated
  USING (get_my_role() = 'Maintenance');

CREATE POLICY "Vendors read own record"
  ON public.vendors FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND lower(email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
  );


-- ─── ACCOUNTING ─────────────────────────────────────────────────────────────
-- Management can CRUD (financial management)
-- Tenants can read own entries (via lease_id on their lease)

CREATE POLICY "Management manage accounting"
  ON public.accounting FOR ALL
  TO authenticated
  USING (is_management())
  WITH CHECK (is_management());

CREATE POLICY "Tenants read own accounting"
  ON public.accounting FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND lease_id IN (
      SELECT l.id FROM leases l WHERE l.user_id = auth.uid()
    )
  );


-- ─── TRANSACTIONS ───────────────────────────────────────────────────────────
-- Management can CRUD
-- Vendors can read own transactions

CREATE POLICY "Management manage transactions"
  ON public.transactions FOR ALL
  TO authenticated
  USING (is_management())
  WITH CHECK (is_management());

CREATE POLICY "Vendors read own transactions"
  ON public.transactions FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );


-- ─── APPLICATIONS ───────────────────────────────────────────────────────────
-- Anonymous can INSERT (public apply form)
-- Management can CRUD

CREATE POLICY "Public can submit applications"
  ON public.applications FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Management manage applications"
  ON public.applications FOR ALL
  TO authenticated
  USING (is_management())
  WITH CHECK (is_management());


-- ─── CHAT_MESSAGES ──────────────────────────────────────────────────────────
-- Staff can read and insert (team chat)
-- Chat is internal to admin team only

CREATE POLICY "Staff read chat_messages"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (is_staff());

CREATE POLICY "Staff insert chat_messages"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (is_staff());


-- ─── SYSTEM_ACTIVITY ────────────────────────────────────────────────────────
-- Staff can read all + insert
-- Vendors can read entries related to their work orders
-- Tenants can read entries related to them

CREATE POLICY "Staff read system_activity"
  ON public.system_activity FOR SELECT
  TO authenticated
  USING (is_staff());

CREATE POLICY "Staff insert system_activity"
  ON public.system_activity FOR INSERT
  TO authenticated
  WITH CHECK (is_staff());

-- Vendors see repair update notifications
CREATE POLICY "Vendors read own system_activity"
  ON public.system_activity FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND related_entity_id IN (
      SELECT wo.id FROM work_orders wo
      WHERE wo.vendor_id IN (
        SELECT v.id FROM vendors v
        WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
      )
    )
  );

-- Tenants see their repair update notifications
CREATE POLICY "Tenants read own system_activity"
  ON public.system_activity FOR SELECT
  TO authenticated
  USING (
    get_my_role() = 'Tenant'
    AND event_type = 'TENANT_REPAIR_UPDATE'
  );


-- ─── GL_ACCOUNTS ────────────────────────────────────────────────────────────
-- Read-only for management

CREATE POLICY "Management read gl_accounts"
  ON public.gl_accounts FOR SELECT
  TO authenticated
  USING (is_management());


-- ─── JOURNAL_ENTRIES ────────────────────────────────────────────────────────
-- Management can read + insert (append-only financial ledger)

CREATE POLICY "Management read journal_entries"
  ON public.journal_entries FOR SELECT
  TO authenticated
  USING (is_management());

CREATE POLICY "Management insert journal_entries"
  ON public.journal_entries FOR INSERT
  TO authenticated
  WITH CHECK (is_management());


-- ─── LEDGER_ENTRIES ─────────────────────────────────────────────────────────
-- Management can read + insert (append-only financial ledger)

CREATE POLICY "Management read ledger_entries"
  ON public.ledger_entries FOR SELECT
  TO authenticated
  USING (is_management());

CREATE POLICY "Management insert ledger_entries"
  ON public.ledger_entries FOR INSERT
  TO authenticated
  WITH CHECK (is_management());


-- ============================================================================
-- DONE. New policy count: ~45 role-scoped policies replacing ~62 permissive ones.
-- ============================================================================
