-- ============================================================
-- RYLEXA PM - DATABASE MIGRATION
-- Creates missing views, tables, and RPC functions
-- required by the Next.js frontend.
--
-- RUN THIS IN: Supabase Dashboard > SQL Editor
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. SYSTEM_ACTIVITY TABLE
-- Used by: ActivityFeed.tsx, ReconciliationDrawer.tsx,
--          useDistributions.ts
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.system_activity (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type    text NOT NULL DEFAULT 'SYSTEM',
  title         text NOT NULL,
  description   text,
  actor_name    text,
  created_at    timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.system_activity ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read activity
CREATE POLICY "Authenticated users can read system_activity"
  ON public.system_activity FOR SELECT
  TO authenticated
  USING (true);

-- Allow authenticated users to insert activity
CREATE POLICY "Authenticated users can insert system_activity"
  ON public.system_activity FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Enable realtime for the live activity feed
ALTER PUBLICATION supabase_realtime ADD TABLE public.system_activity;


-- ────────────────────────────────────────────────────────────
-- 2. LEASE_DETAILS_VIEW
-- Used by: useLeases.ts (fetchLeases), useProperties.ts
-- Joins leases → units → properties → tenants
-- ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.lease_details_view CASCADE;
CREATE OR REPLACE VIEW public.lease_details_view AS
SELECT
  l.id          AS lease_id,
  p.name        AS property_name,
  u.name        AS unit_name,
  t.first_name,
  t.last_name,
  l.rent_amount,
  l.status,
  l.end_date
FROM public.leases l
JOIN public.units u      ON l.unit_id = u.id
JOIN public.properties p ON u.property_id = p.id
JOIN public.tenants t    ON l.tenant_id = t.id;


-- ────────────────────────────────────────────────────────────
-- 3. VIEW_PROFIT_AND_LOSS
-- Used by: useFinancials.ts, useDistributions.ts
-- Aggregates income (rent from active leases) and expenses
-- (from transactions) per property.
-- ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS public.view_profit_and_loss CASCADE;
CREATE OR REPLACE VIEW public.view_profit_and_loss AS
SELECT
  p.id                         AS property_id,
  p.name                       AS property_name,
  COALESCE(income.total, 0)    AS total_income,
  COALESCE(expenses.total, 0)  AS total_expenses,
  COALESCE(income.total, 0) - COALESCE(expenses.total, 0) AS net_operating_income
FROM public.properties p
LEFT JOIN (
  -- Sum rent from active leases per property
  SELECT
    pr.id AS property_id,
    SUM(l.rent_amount) AS total
  FROM public.leases l
  JOIN public.units u      ON l.unit_id = u.id
  JOIN public.properties pr ON u.property_id = pr.id
  WHERE l.status = 'Active'
  GROUP BY pr.id
) income ON income.property_id = p.id
LEFT JOIN (
  -- Sum debit transactions per property (via lease → unit → property)
  SELECT
    pr.id AS property_id,
    SUM(ABS(tx.amount)) AS total
  FROM public.transactions tx
  JOIN public.leases l     ON tx.lease_id = l.id
  JOIN public.units u      ON l.unit_id = u.id
  JOIN public.properties pr ON u.property_id = pr.id
  WHERE tx.type = 'Debit'
  GROUP BY pr.id
) expenses ON expenses.property_id = p.id;


-- ────────────────────────────────────────────────────────────
-- 4. RPC: move_in_tenant
-- Used by: NewLeaseModal.tsx
-- Creates a tenant (or reuses existing), creates the lease,
-- and marks the unit as Occupied.
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.move_in_tenant(uuid,text,text,text,text,numeric,numeric,date,date,uuid);
CREATE OR REPLACE FUNCTION public.move_in_tenant(
  p_unit_id           uuid,
  p_first_name        text,
  p_last_name         text,
  p_email             text DEFAULT NULL,
  p_phone             text DEFAULT NULL,
  p_rent              numeric DEFAULT 0,
  p_deposit           numeric DEFAULT 0,
  p_start_date        date DEFAULT CURRENT_DATE,
  p_end_date          date DEFAULT NULL,
  p_existing_tenant_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- 1. Resolve or create tenant
  IF p_existing_tenant_id IS NOT NULL THEN
    v_tenant_id := p_existing_tenant_id;
    -- Update contact info if provided
    UPDATE public.tenants
    SET email = COALESCE(NULLIF(p_email, ''), email),
        phone = COALESCE(NULLIF(p_phone, ''), phone)
    WHERE id = v_tenant_id;
  ELSE
    INSERT INTO public.tenants (first_name, last_name, email, phone, status)
    VALUES (p_first_name, p_last_name, p_email, p_phone, 'Active')
    RETURNING id INTO v_tenant_id;
  END IF;

  -- 2. Create the lease
  INSERT INTO public.leases (tenant_id, unit_id, rent_amount, security_deposit, start_date, end_date, status)
  VALUES (v_tenant_id, p_unit_id, p_rent, p_deposit, p_start_date, p_end_date, 'Active');

  -- 3. Mark unit as occupied
  UPDATE public.units SET status = 'Occupied' WHERE id = p_unit_id;

  -- 4. Update tenant status
  UPDATE public.tenants SET status = 'Active' WHERE id = v_tenant_id;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 5. RPC: update_lease_details
-- Used by: EditLeaseModal.tsx
-- Updates rent, deposit, end_date on the lease,
-- and email/phone on the linked tenant.
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.update_lease_details(uuid,numeric,numeric,date,text,text);
CREATE OR REPLACE FUNCTION public.update_lease_details(
  p_lease_id  uuid,
  p_rent      numeric DEFAULT NULL,
  p_deposit   numeric DEFAULT NULL,
  p_end_date  date DEFAULT NULL,
  p_phone     text DEFAULT NULL,
  p_email     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- 1. Update lease fields
  UPDATE public.leases
  SET
    rent_amount      = COALESCE(p_rent, rent_amount),
    security_deposit = COALESCE(p_deposit, security_deposit),
    end_date         = p_end_date  -- Allow setting to NULL (month-to-month)
  WHERE id = p_lease_id;

  -- 2. Get tenant ID
  SELECT tenant_id INTO v_tenant_id FROM public.leases WHERE id = p_lease_id;

  -- 3. Update tenant contact info
  IF v_tenant_id IS NOT NULL THEN
    UPDATE public.tenants
    SET
      phone = COALESCE(NULLIF(p_phone, ''), phone),
      email = COALESCE(NULLIF(p_email, ''), email)
    WHERE id = v_tenant_id;
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 6. RPC: end_lease
-- Used by: EndLeaseModal.tsx
-- Ends a lease, marks the unit as Vacant,
-- and updates tenant status.
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.end_lease(uuid,date);
CREATE OR REPLACE FUNCTION public.end_lease(
  p_lease_id     uuid,
  p_move_out_date date DEFAULT CURRENT_DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_unit_id   uuid;
  v_tenant_id uuid;
BEGIN
  -- 1. Get the linked unit and tenant
  SELECT unit_id, tenant_id INTO v_unit_id, v_tenant_id
  FROM public.leases WHERE id = p_lease_id;

  -- 2. End the lease
  UPDATE public.leases
  SET status   = 'Expired',
      end_date = p_move_out_date
  WHERE id = p_lease_id;

  -- 3. Mark unit as vacant
  IF v_unit_id IS NOT NULL THEN
    UPDATE public.units SET status = 'Vacant' WHERE id = v_unit_id;
  END IF;

  -- 4. Update tenant status (only if no other active leases)
  IF v_tenant_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.leases
      WHERE tenant_id = v_tenant_id AND status = 'Active' AND id != p_lease_id
    ) THEN
      UPDATE public.tenants SET status = 'Past' WHERE id = v_tenant_id;
    END IF;
  END IF;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 7. RPC: move_lease_to_new_unit
-- Used by: MoveLeaseModal.tsx
-- Transfers an active lease to a different unit.
-- Old unit → Vacant, New unit → Occupied.
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.move_lease_to_new_unit(uuid,uuid);
CREATE OR REPLACE FUNCTION public.move_lease_to_new_unit(
  p_lease_id   uuid,
  p_new_unit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_unit_id uuid;
BEGIN
  -- 1. Get the current unit
  SELECT unit_id INTO v_old_unit_id FROM public.leases WHERE id = p_lease_id;

  -- 2. Mark old unit as vacant
  IF v_old_unit_id IS NOT NULL THEN
    UPDATE public.units SET status = 'Vacant' WHERE id = v_old_unit_id;
  END IF;

  -- 3. Update the lease to point to new unit
  UPDATE public.leases SET unit_id = p_new_unit_id WHERE id = p_lease_id;

  -- 4. Mark new unit as occupied
  UPDATE public.units SET status = 'Occupied' WHERE id = p_new_unit_id;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 8. RPC: post_monthly_rent
-- Used by: PostRentModal.tsx
-- Creates accounting entries for all active leases
-- for a given month (skipping duplicates).
-- Returns the count of new charges created.
-- ────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.post_monthly_rent(date);
CREATE OR REPLACE FUNCTION public.post_monthly_rent(
  target_date date DEFAULT CURRENT_DATE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer := 0;
  v_month_start date;
  v_month_end date;
  r RECORD;
BEGIN
  v_month_start := date_trunc('month', target_date)::date;
  v_month_end   := (date_trunc('month', target_date) + interval '1 month' - interval '1 day')::date;

  FOR r IN
    SELECT l.id AS lease_id, l.rent_amount, l.user_id
    FROM public.leases l
    WHERE l.status = 'Active'
      AND l.rent_amount > 0
      -- Skip if an accounting entry already exists for this lease+month
      AND NOT EXISTS (
        SELECT 1 FROM public.accounting a
        WHERE a.lease_id = l.id
          AND a.created_at >= v_month_start
          AND a.created_at < v_month_end + interval '1 day'
          AND a.type = 'Rent Charge'
      )
  LOOP
    INSERT INTO public.accounting (lease_id, user_id, type, amount, description, created_at)
    VALUES (
      r.lease_id,
      r.user_id,
      'Rent Charge',
      r.rent_amount,
      'Monthly rent charge for ' || to_char(target_date, 'Month YYYY'),
      target_date
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 9. RPC: update_ticket_status
-- Used by: useMaintenance.ts (updateTicket)
-- Updates a work order's status, vendor assignment,
-- cost, and manager notes.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_ticket_status(
  ticket_id    uuid,
  new_status   text DEFAULT NULL,
  vendor_name  text DEFAULT NULL,
  repair_cost  numeric DEFAULT NULL,
  manager_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_vendor_id uuid;
BEGIN
  -- 1. Resolve vendor by name if provided
  IF vendor_name IS NOT NULL AND vendor_name != '' THEN
    SELECT id INTO v_vendor_id
    FROM public.vendors
    WHERE company_name = vendor_name OR contact_name = vendor_name
    LIMIT 1;
  END IF;

  -- 2. Update the work order
  UPDATE public.work_orders
  SET
    status     = COALESCE(new_status, status),
    vendor_id  = COALESCE(v_vendor_id, vendor_id),
    cost       = COALESCE(repair_cost, cost),
    notes      = COALESCE(manager_notes, notes)
  WHERE id = ticket_id;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- 10. ENSURE REQUIRED COLUMNS EXIST
-- Some code references columns that may be missing.
-- These are safe "ADD IF NOT EXISTS" statements.
-- ────────────────────────────────────────────────────────────

-- leases table needs these columns
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leases' AND column_name='security_deposit') THEN
    ALTER TABLE public.leases ADD COLUMN security_deposit numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leases' AND column_name='start_date') THEN
    ALTER TABLE public.leases ADD COLUMN start_date date DEFAULT CURRENT_DATE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leases' AND column_name='end_date') THEN
    ALTER TABLE public.leases ADD COLUMN end_date date;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leases' AND column_name='rent_amount') THEN
    ALTER TABLE public.leases ADD COLUMN rent_amount numeric DEFAULT 0;
  END IF;

  -- work_orders may need cost and notes columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='work_orders' AND column_name='cost') THEN
    ALTER TABLE public.work_orders ADD COLUMN cost numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='work_orders' AND column_name='notes') THEN
    ALTER TABLE public.work_orders ADD COLUMN notes text;
  END IF;

  -- accounting may need type and amount columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounting' AND column_name='type') THEN
    ALTER TABLE public.accounting ADD COLUMN type text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounting' AND column_name='amount') THEN
    ALTER TABLE public.accounting ADD COLUMN amount numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounting' AND column_name='description') THEN
    ALTER TABLE public.accounting ADD COLUMN description text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='accounting' AND column_name='created_at') THEN
    ALTER TABLE public.accounting ADD COLUMN created_at timestamptz DEFAULT now();
  END IF;

  -- units may need status and market_rent columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='units' AND column_name='status') THEN
    ALTER TABLE public.units ADD COLUMN status text DEFAULT 'Vacant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='units' AND column_name='market_rent') THEN
    ALTER TABLE public.units ADD COLUMN market_rent numeric;
  END IF;

  -- tenants may need status column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='status') THEN
    ALTER TABLE public.tenants ADD COLUMN status text DEFAULT 'Active';
  END IF;

  -- transactions may need status column
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='status') THEN
    ALTER TABLE public.transactions ADD COLUMN status text DEFAULT 'Pending';
  END IF;
END $$;


-- ────────────────────────────────────────────────────────────
-- DONE. All views, functions, and columns are now in place.
-- ────────────────────────────────────────────────────────────
