-- ============================================================
-- 038_reports.sql
-- Reporting & Exports: views, report_exports table, feature flag
-- ============================================================

-- ── 1A. Rent Roll View ──
CREATE OR REPLACE VIEW public.view_rent_roll
WITH (security_invoker = true)
AS
SELECT
  l.id AS lease_id,
  p.id AS property_id,
  p.name AS property_name,
  u.id AS unit_id,
  u.name AS unit_name,
  u.market_rent,
  t.id AS tenant_id,
  t.first_name,
  t.last_name,
  t.email AS tenant_email,
  t.phone AS tenant_phone,
  l.rent_amount,
  l.start_date,
  l.end_date,
  l.status AS lease_status
FROM public.leases l
JOIN public.tenants t ON l.tenant_id = t.id
JOIN public.units u ON l.unit_id = u.id
JOIN public.properties p ON u.property_id = p.id
WHERE l.status IN ('Active', 'Month-to-Month');

-- ── 1B. AR Aging View ──
CREATE OR REPLACE VIEW public.view_ar_aging
WITH (security_invoker = true)
AS
SELECT
  l.id AS lease_id,
  t.id AS tenant_id,
  t.first_name,
  t.last_name,
  t.email AS tenant_email,
  u.name AS unit_name,
  p.id AS property_id,
  p.name AS property_name,
  l.rent_amount,
  COALESCE(charges.total_charges, 0) - COALESCE(payments.total_payments, 0) AS balance_due,
  COALESCE(charges.total_charges, 0) AS total_charges,
  COALESCE(payments.total_payments, 0) AS total_payments,
  CASE
    WHEN COALESCE(charges.total_charges, 0) - COALESCE(payments.total_payments, 0) <= 0 THEN 'current'
    WHEN (NOW()::date - COALESCE(charges.oldest_charge_date, NOW()::date)) <= 30 THEN '0-30'
    WHEN (NOW()::date - COALESCE(charges.oldest_charge_date, NOW()::date)) <= 60 THEN '31-60'
    WHEN (NOW()::date - COALESCE(charges.oldest_charge_date, NOW()::date)) <= 90 THEN '61-90'
    ELSE '90+'
  END AS aging_bucket
FROM public.leases l
JOIN public.tenants t ON l.tenant_id = t.id
JOIN public.units u ON l.unit_id = u.id
JOIN public.properties p ON u.property_id = p.id
LEFT JOIN (
  SELECT lease_id,
         SUM(amount) AS total_charges,
         MIN(created_at::date) AS oldest_charge_date
  FROM public.accounting
  WHERE type IN ('Rent Charge', 'Late Fee', 'Utility Charge')
  GROUP BY lease_id
) charges ON charges.lease_id = l.id
LEFT JOIN (
  SELECT lease_id, SUM(amount) AS total_payments
  FROM public.accounting
  WHERE type IN ('Payment', 'Credit')
  GROUP BY lease_id
) payments ON payments.lease_id = l.id
WHERE l.status = 'Active';

-- ── 1C. Report Exports Table ──
CREATE TABLE public.report_exports (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  report_type  text NOT NULL CHECK (report_type IN ('rent_roll','profit_loss','vacancy','maintenance_cost','ar_aging','owner_statement')),
  format       text NOT NULL CHECK (format IN ('csv','pdf')),
  filters      jsonb DEFAULT '{}'::jsonb,
  storage_path text,
  generated_by uuid REFERENCES auth.users(id),
  created_at   timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE public.report_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "management_full_report_exports"
  ON public.report_exports FOR ALL
  USING (is_management())
  WITH CHECK (is_management());

CREATE POLICY "accounting_read_report_exports"
  ON public.report_exports FOR SELECT
  USING (get_my_role() = 'Accounting');

CREATE INDEX idx_report_exports_type ON public.report_exports(report_type);
CREATE INDEX idx_report_exports_created ON public.report_exports(created_at DESC);

-- ── 1D. Feature Flag ──
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('reports', true, 'Enable Reporting & Exports hub')
ON CONFLICT (key) DO NOTHING;
