-- ============================================================================
-- Migration 012: View & Function Hardening
--
-- Phase 3 of the security remediation plan:
-- 1. Recreate all 5 SECURITY DEFINER views as SECURITY INVOKER
--    (so they now respect RLS policies from Phase 2)
-- 2. Set search_path = '' on ALL public functions to prevent
--    search_path manipulation attacks
-- 3. Drop the duplicate (old) update_ticket_status overload
--
-- ROLLBACK: Reverse each CREATE OR REPLACE with the original definition.
-- View rollback: DROP VIEW + CREATE VIEW without security_invoker=true.
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Recreate views with SECURITY INVOKER
-- ============================================================================
-- By default PostgreSQL views use SECURITY DEFINER (the view owner's perms).
-- SECURITY INVOKER makes them respect the CALLING user's RLS policies.
-- We DROP + CREATE to change the security property (ALTER VIEW cannot do this).

-- ─── lease_details_view ────────────────────────────────────────────────────
-- Used by: useProperties.ts, useLeases.ts
DROP VIEW IF EXISTS public.lease_details_view;
CREATE VIEW public.lease_details_view
WITH (security_invoker = true)
AS
SELECT
  l.id AS lease_id,
  p.name AS property_name,
  u.name AS unit_name,
  t.first_name,
  t.last_name,
  l.rent_amount,
  l.status,
  l.end_date
FROM leases l
JOIN units u ON l.unit_id = u.id
JOIN properties p ON u.property_id = p.id
JOIN tenants t ON l.tenant_id = t.id;

-- ─── view_profit_and_loss ──────────────────────────────────────────────────
-- Used by: useDistributions.ts, useFinancials.ts, scorecard, reports
DROP VIEW IF EXISTS public.view_profit_and_loss;
CREATE VIEW public.view_profit_and_loss
WITH (security_invoker = true)
AS
SELECT
  p.id AS property_id,
  p.name AS property_name,
  COALESCE(income.total, 0::numeric) AS total_income,
  COALESCE(expenses.total, 0::numeric) AS total_expenses,
  COALESCE(income.total, 0::numeric) - COALESCE(expenses.total, 0::numeric) AS net_operating_income
FROM properties p
LEFT JOIN (
  SELECT pr.id AS property_id, sum(l.rent_amount) AS total
  FROM leases l
  JOIN units u ON l.unit_id = u.id
  JOIN properties pr ON u.property_id = pr.id
  WHERE l.status = 'Active'
  GROUP BY pr.id
) income ON income.property_id = p.id
LEFT JOIN (
  SELECT pr.id AS property_id, sum(abs(tx.amount)) AS total
  FROM transactions tx
  JOIN leases l ON tx.lease_id = l.id
  JOIN units u ON l.unit_id = u.id
  JOIN properties pr ON u.property_id = pr.id
  WHERE tx.type = 'Debit'
  GROUP BY pr.id
) expenses ON expenses.property_id = p.id;

-- ─── available_units ───────────────────────────────────────────────────────
-- Used by: apply/page.tsx (public application form)
-- NOTE: This view is queried by anon users on the apply form.
-- With SECURITY INVOKER, anon has no SELECT on units/properties.
-- We must GRANT SELECT on this view to anon explicitly, then use
-- security_invoker = false (DEFINER) for this one view ONLY.
-- This is intentional — available_units is a public-facing read-only view.
DROP VIEW IF EXISTS public.available_units;
CREATE VIEW public.available_units
WITH (security_invoker = false)
AS
SELECT
  u.id,
  u.name,
  u.property_id,
  p.name AS property_name
FROM units u
JOIN properties p ON u.property_id = p.id
WHERE NOT EXISTS (
  SELECT 1 FROM leases l
  WHERE l.unit_id = u.id AND l.status = 'Active'
);

-- Ensure anon can query available units for the public apply form
GRANT SELECT ON public.available_units TO anon;
GRANT SELECT ON public.available_units TO authenticated;

-- ─── work_orders_view ──────────────────────────────────────────────────────
-- Currently unused in frontend but may be used by future reports.
-- Make it respect RLS so it's safe.
DROP VIEW IF EXISTS public.work_orders_view;
CREATE VIEW public.work_orders_view
WITH (security_invoker = true)
AS
SELECT
  w.id,
  w.title,
  w.description,
  w.priority,
  w.status,
  w.created_at,
  w.vendor_id,
  u.name AS unit_name,
  p.name AS property_name,
  v.company_name,
  v.contact_name,
  v.trade_type,
  v.phone AS vendor_phone
FROM work_orders w
JOIN units u ON w.unit_id = u.id
JOIN properties p ON u.property_id = p.id
LEFT JOIN vendors v ON w.vendor_id = v.id;

-- ─── audit_rent_view ──────────────────────────────────────────────────────
-- Currently unused in frontend. Management-only report view.
DROP VIEW IF EXISTS public.audit_rent_view;
CREATE VIEW public.audit_rent_view
WITH (security_invoker = true)
AS
SELECT
  l.id AS lease_id,
  p.name AS property_name,
  u.name AS unit_name,
  (t.first_name || ' ' || t.last_name) AS tenant_name,
  l.rent_amount,
  CASE
    WHEN l.end_date IS NULL THEN 'Month-to-Month'
    ELSE 'Fixed Term'
  END AS lease_type
FROM leases l
JOIN units u ON l.unit_id = u.id
JOIN properties p ON u.property_id = p.id
JOIN tenants t ON l.tenant_id = t.id
WHERE l.status = 'Active' AND l.rent_amount < 600
ORDER BY l.rent_amount;


-- ============================================================================
-- STEP 2: Set search_path on ALL functions
-- ============================================================================
-- Functions without explicit search_path can be exploited if an attacker
-- creates objects in a schema that appears earlier in the search_path.
-- Setting SET search_path = '' forces fully-qualified references.

-- ─── RLS helper functions (from Phase 2) ───────────────────────────────────

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
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
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
  RETURN (SELECT role FROM public.profiles WHERE id = auth.uid())
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
  RETURN (SELECT role FROM public.profiles WHERE id = auth.uid())
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
DECLARE
  current_role text;
BEGIN
  SELECT role INTO current_role FROM public.profiles WHERE id = auth.uid();
  RETURN current_role IN ('Admin', 'Property Manager');
END;
$$;

-- ─── Business logic functions ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.approve_application(
  app_id uuid, lease_start date, lease_end date, rent_price numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_record RECORD;
    new_tenant_id UUID;
BEGIN
    SELECT * INTO app_record FROM public.applications WHERE id = app_id;
    IF app_record IS NULL THEN
        RAISE EXCEPTION 'Application not found.';
    END IF;

    INSERT INTO public.tenants (first_name, last_name, email, phone, status)
    VALUES (app_record.first_name, app_record.last_name, app_record.email, app_record.phone, 'Active')
    RETURNING id INTO new_tenant_id;

    INSERT INTO public.leases (tenant_id, unit_id, start_date, end_date, rent_amount, status)
    VALUES (new_tenant_id, app_record.unit_id, lease_start, lease_end, rent_price, 'Active');

    UPDATE public.applications SET status = 'Approved' WHERE id = app_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.end_lease(
  p_lease_id uuid, p_move_out_date date DEFAULT CURRENT_DATE
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_unit_id   uuid;
  v_tenant_id uuid;
BEGIN
  SELECT unit_id, tenant_id INTO v_unit_id, v_tenant_id
  FROM public.leases WHERE id = p_lease_id;

  UPDATE public.leases
  SET status   = 'Expired',
      end_date = p_move_out_date
  WHERE id = p_lease_id;

  IF v_unit_id IS NOT NULL THEN
    UPDATE public.units SET status = 'Vacant' WHERE id = v_unit_id;
  END IF;

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

CREATE OR REPLACE FUNCTION public.get_dashboard_alerts()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    app_count INT;
    app_list JSON;
    ticket_count INT;
    ticket_list JSON;
    future_count INT;
    future_list JSON;
    lease_count INT;
    lease_list JSON;
BEGIN
    SELECT count(*) INTO app_count FROM public.applications WHERE status = 'Pending';

    SELECT json_agg(t) INTO app_list FROM (
        SELECT first_name, last_name,
               COALESCE((SELECT name FROM public.units WHERE id = a.unit_id), 'Unknown Unit') as unit_name,
               created_at
        FROM public.applications a WHERE status = 'Pending'
        ORDER BY created_at DESC LIMIT 3
    ) t;

    SELECT count(*) INTO ticket_count FROM public.work_orders WHERE status NOT IN ('Closed', 'Done');

    SELECT json_agg(t) INTO ticket_list FROM (
        SELECT
            title, priority, created_at,
            COALESCE((SELECT name FROM public.units WHERE id = wo.unit_id), 'General') as unit_name,
            assigned_vendor
        FROM public.work_orders wo
        WHERE status NOT IN ('Closed', 'Done')
        ORDER BY created_at DESC LIMIT 3
    ) t;

    SELECT count(*) INTO future_count FROM public.leases WHERE start_date >= CURRENT_DATE;
    SELECT json_agg(t) INTO future_list FROM (
        SELECT
            (SELECT first_name FROM public.tenants WHERE id = ls.tenant_id) as first_name,
            (SELECT last_name FROM public.tenants WHERE id = ls.tenant_id) as last_name,
            COALESCE((SELECT name FROM public.units WHERE id = ls.unit_id), 'Unknown Unit') as unit_name,
            start_date
        FROM public.leases ls WHERE start_date >= CURRENT_DATE ORDER BY start_date ASC LIMIT 3
    ) t;

    SELECT count(*) INTO lease_count FROM public.leases
    WHERE end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '45 days');

    SELECT json_agg(t) INTO lease_list FROM (
        SELECT
            (SELECT name FROM public.properties WHERE id = (SELECT property_id FROM public.units WHERE id = le.unit_id)) as property_name,
            (SELECT name FROM public.units WHERE id = le.unit_id) as unit_name,
            (SELECT first_name FROM public.tenants WHERE id = le.tenant_id) as first_name,
            (SELECT last_name FROM public.tenants WHERE id = le.tenant_id) as last_name,
            end_date
        FROM public.leases le WHERE end_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + INTERVAL '45 days') ORDER BY end_date ASC LIMIT 3
    ) t;

    RETURN json_build_object(
        'app_count', COALESCE(app_count, 0),
        'app_list', COALESCE(app_list, '[]'::json),
        'ticket_count', COALESCE(ticket_count, 0),
        'ticket_list', COALESCE(ticket_list, '[]'::json),
        'future_count', COALESCE(future_count, 0),
        'future_list', COALESCE(future_list, '[]'::json),
        'lease_count', COALESCE(lease_count, 0),
        'lease_list', COALESCE(lease_list, '[]'::json)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_financial_cashflow()
RETURNS json
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RETURN (
    SELECT json_agg(t) FROM (
      SELECT
        TO_CHAR(date, 'Mon') as month,
        SUM(CASE WHEN type = 'Income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type = 'Expense' THEN ABS(amount) ELSE 0 END) as expense,
        DATE_TRUNC('month', date) as sort_date
      FROM public.transactions
      WHERE date > (CURRENT_DATE - INTERVAL '6 months')
      GROUP BY 1, 4
      ORDER BY 4 ASC
    ) t
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_portfolio_stats()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  total_u integer;
  occupied_u integer;
  monthly_rev numeric;
  occ_rate numeric;
BEGIN
  SELECT count(*) INTO total_u FROM public.units;
  SELECT count(*) INTO occupied_u FROM public.units WHERE status = 'Occupied';

  SELECT COALESCE(SUM(rent_amount), 0) INTO monthly_rev
  FROM public.leases
  WHERE status = 'Active';

  IF total_u > 0 THEN
    occ_rate := (occupied_u::numeric / total_u::numeric) * 100;
  ELSE
    occ_rate := 0;
  END IF;

  RETURN json_build_object(
    'total_units', total_u,
    'occupied_units', occupied_u,
    'occupancy_rate', ROUND(occ_rate, 1),
    'monthly_revenue', monthly_rev
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_portal_data(target_email text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result json;
BEGIN
  SELECT json_build_object(
    'tenant', json_build_object(
      'id', t.id,
      'first_name', t.first_name,
      'last_name', t.last_name
    ),
    'unit', json_build_object(
      'id', u.id,
      'name', u.name,
      'property_name', p.name
    ),
    'lease', json_build_object(
      'rent_amount', l.rent_amount,
      'end_date', l.end_date
    ),
    'recent_payments', COALESCE((
      SELECT json_agg(row_to_json(pay))
      FROM (
        SELECT a.amount, a.created_at AS date, a.description, a.status
        FROM public.accounting a
        WHERE a.lease_id = l.id
        ORDER BY a.created_at DESC
        LIMIT 10
      ) pay
    ), '[]'::json),
    'open_tickets_count', (
      SELECT COUNT(*)
      FROM public.work_orders wo
      WHERE wo.tenant_id = t.id
        AND wo.status IN ('Open', 'In Progress')
    )
  ) INTO v_result
  FROM public.tenants t
  JOIN public.leases l ON l.tenant_id = t.id AND l.status = 'Active'
  JOIN public.units u ON l.unit_id = u.id
  JOIN public.properties p ON u.property_id = p.id
  WHERE t.email = target_email
  LIMIT 1;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_profile(search_text text)
RETURNS TABLE(
  id uuid, full_name text, email text, phone text, status text,
  property_name text, unit_name text, rent_amount numeric, lease_end date,
  has_pets boolean, late_count integer, balance numeric, ledger json
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY
    SELECT
        t.id,
        (t.first_name || ' ' || t.last_name)::text,
        t.email::text,
        COALESCE(t.phone, '')::text,
        t.status::text,
        COALESCE(p.name, 'No Property')::text,
        COALESCE(u.name, 'No Unit')::text,
        COALESCE(l.rent_amount, 0)::numeric,
        l.end_date,
        (COALESCE(l.rent_amount, 0) > 0)::boolean,
        (
            SELECT count(*)::integer
            FROM public.transactions tr_late
            WHERE tr_late.lease_id = l.id
            AND tr_late.status = 'Late'
        ),
        (
          COALESCE((SELECT sum(tr_inc.amount) FROM public.transactions tr_inc WHERE tr_inc.lease_id = l.id AND tr_inc.type = 'Income'), 0) -
          COALESCE((SELECT sum(tr_pay.amount) FROM public.transactions tr_pay WHERE tr_pay.lease_id = l.id AND tr_pay.type = 'Payment'), 0)
        )::numeric,
        COALESCE(
            (
                SELECT json_agg(json_build_object(
                    'date', led.date,
                    'description', led.description,
                    'amount', led.amount,
                    'status', led.status,
                    'type', led.type
                ))
                FROM (
                    SELECT
                        tr_ledger.date,
                        tr_ledger.description,
                        tr_ledger.amount,
                        tr_ledger.status,
                        tr_ledger.type
                    FROM public.transactions tr_ledger
                    WHERE tr_ledger.lease_id = l.id
                    ORDER BY tr_ledger.date DESC
                    LIMIT 10
                ) led
            ),
            '[]'::json
        )
    FROM public.tenants t
    LEFT JOIN public.leases l ON t.id = l.tenant_id AND l.status = 'Active'
    LEFT JOIN public.units u ON l.unit_id = u.id
    LEFT JOIN public.properties p ON u.property_id = p.id
    WHERE t.first_name ILIKE '%' || search_text || '%'
       OR t.last_name ILIKE '%' || search_text || '%'
       OR t.email ILIKE '%' || search_text || '%'
    LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_in_tenant(
  p_unit_id uuid, p_first_name text, p_last_name text,
  p_email text DEFAULT NULL, p_phone text DEFAULT NULL,
  p_rent numeric DEFAULT 0, p_deposit numeric DEFAULT 0,
  p_start_date date DEFAULT CURRENT_DATE, p_end_date date DEFAULT NULL,
  p_existing_tenant_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_existing_tenant_id IS NOT NULL THEN
    v_tenant_id := p_existing_tenant_id;
    UPDATE public.tenants
    SET email = COALESCE(NULLIF(p_email, ''), email),
        phone = COALESCE(NULLIF(p_phone, ''), phone)
    WHERE id = v_tenant_id;
  ELSE
    INSERT INTO public.tenants (first_name, last_name, email, phone, status)
    VALUES (p_first_name, p_last_name, p_email, p_phone, 'Active')
    RETURNING id INTO v_tenant_id;
  END IF;

  INSERT INTO public.leases (tenant_id, unit_id, rent_amount, security_deposit, start_date, end_date, status)
  VALUES (v_tenant_id, p_unit_id, p_rent, p_deposit, p_start_date, p_end_date, 'Active');

  UPDATE public.units SET status = 'Occupied' WHERE id = p_unit_id;
  UPDATE public.tenants SET status = 'Active' WHERE id = v_tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_lease_to_new_unit(p_lease_id uuid, p_new_unit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old_unit_id uuid;
BEGIN
  SELECT unit_id INTO v_old_unit_id FROM public.leases WHERE id = p_lease_id;

  IF v_old_unit_id IS NOT NULL THEN
    UPDATE public.units SET status = 'Vacant' WHERE id = v_old_unit_id;
  END IF;

  UPDATE public.leases SET unit_id = p_new_unit_id WHERE id = p_lease_id;
  UPDATE public.units SET status = 'Occupied' WHERE id = p_new_unit_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_monthly_rent(target_date date DEFAULT CURRENT_DATE)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
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

CREATE OR REPLACE FUNCTION public.search_global(search_term text)
RETURNS TABLE(type text, id uuid, title text, subtitle text, url text)
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY

    SELECT
        'Tenant'::TEXT,
        t.id,
        (t.first_name || ' ' || t.last_name)::TEXT,
        ('Unit ' || u.name)::TEXT,
        ('/tenants?q=' || t.email)::TEXT
    FROM public.tenants t
    JOIN public.leases l ON t.id = l.tenant_id
    JOIN public.units u ON l.unit_id = u.id
    WHERE t.first_name ILIKE '%' || search_term || '%'
       OR t.last_name ILIKE '%' || search_term || '%'
       OR t.email ILIKE '%' || search_term || '%'

    UNION ALL

    SELECT
        'Property'::TEXT,
        p.id,
        p.name::TEXT,
        p.address::TEXT,
        '/leases'::TEXT
    FROM public.properties p
    WHERE p.name ILIKE '%' || search_term || '%'

    UNION ALL

    SELECT
        'Ticket'::TEXT,
        w.id,
        w.title::TEXT,
        w.status::TEXT,
        '/maintenance'::TEXT
    FROM public.work_orders w
    WHERE w.title ILIKE '%' || search_term || '%'

    LIMIT 10;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_lease_details(
  p_lease_id uuid, p_rent numeric DEFAULT NULL, p_deposit numeric DEFAULT NULL,
  p_end_date date DEFAULT NULL, p_phone text DEFAULT NULL, p_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  UPDATE public.leases
  SET
    rent_amount      = COALESCE(p_rent, rent_amount),
    security_deposit = COALESCE(p_deposit, security_deposit),
    end_date         = p_end_date
  WHERE id = p_lease_id;

  SELECT tenant_id INTO v_tenant_id FROM public.leases WHERE id = p_lease_id;

  IF v_tenant_id IS NOT NULL THEN
    UPDATE public.tenants
    SET
      phone = COALESCE(NULLIF(p_phone, ''), phone),
      email = COALESCE(NULLIF(p_email, ''), email)
    WHERE id = v_tenant_id;
  END IF;
END;
$$;

-- Drop the OLD 5-argument overload (superseded by 9-argument version)
DROP FUNCTION IF EXISTS public.update_ticket_status(uuid, text, text, numeric, text);

-- Recreate the canonical 9-argument version with search_path
CREATE OR REPLACE FUNCTION public.update_ticket_status(
  ticket_id uuid, new_status text DEFAULT NULL, vendor_name text DEFAULT NULL,
  repair_cost numeric DEFAULT NULL, manager_notes text DEFAULT NULL,
  p_hours_worked numeric DEFAULT NULL, p_labor_cost numeric DEFAULT NULL,
  p_invoice_amount numeric DEFAULT NULL, p_materials_cost numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_vendor_id uuid;
BEGIN
  IF vendor_name IS NOT NULL AND vendor_name != '' THEN
    SELECT id INTO v_vendor_id
    FROM public.vendors
    WHERE company_name = vendor_name OR contact_name = vendor_name
    LIMIT 1;
  END IF;

  UPDATE public.work_orders
  SET
    status         = COALESCE(new_status, status),
    vendor_id      = COALESCE(v_vendor_id, vendor_id),
    cost           = COALESCE(repair_cost, cost),
    notes          = COALESCE(manager_notes, notes),
    hours_worked   = COALESCE(p_hours_worked, hours_worked),
    labor_cost     = COALESCE(p_labor_cost, labor_cost),
    invoice_amount = COALESCE(p_invoice_amount, invoice_amount),
    materials_cost = COALESCE(p_materials_cost, materials_cost)
  WHERE id = ticket_id;
END;
$$;

-- ─── Trigger functions (not SECURITY DEFINER, just need search_path) ──────

CREATE OR REPLACE FUNCTION public.fn_auto_ledger_rent_charge()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_journal_id UUID;
    v_ar_account_id UUID;
    v_income_account_id UUID;
BEGIN
    SELECT id INTO v_ar_account_id FROM public.gl_accounts WHERE code = '1100';
    SELECT id INTO v_income_account_id FROM public.gl_accounts WHERE code = '4000';

    INSERT INTO public.journal_entries (description, reference_id, entry_type)
    VALUES (
        'Monthly Rent Charge - ' || TO_CHAR(NEW.date, 'Month YYYY'),
        NEW.lease_id,
        'Rent_Charge'
    ) RETURNING id INTO v_journal_id;

    INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
    VALUES (v_journal_id, v_ar_account_id, NEW.amount, 0);

    INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
    VALUES (v_journal_id, v_income_account_id, 0, NEW.amount);

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_auto_ledger_payment_received()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_journal_id UUID;
    v_cash_account_id UUID;
    v_ar_account_id UUID;
BEGIN
    SELECT id INTO v_cash_account_id FROM public.gl_accounts WHERE code = '1000';
    SELECT id INTO v_ar_account_id FROM public.gl_accounts WHERE code = '1100';

    INSERT INTO public.journal_entries (description, reference_id, entry_type)
    VALUES (
        'Payment Received - ' || NEW.description,
        NEW.lease_id,
        'Payment'
    ) RETURNING id INTO v_journal_id;

    INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
    VALUES (v_journal_id, v_cash_account_id, NEW.amount, 0);

    INSERT INTO public.ledger_entries (journal_entry_id, account_id, debit, credit)
    VALUES (v_journal_id, v_ar_account_id, 0, NEW.amount);

    RETURN NEW;
END;
$$;

COMMIT;
