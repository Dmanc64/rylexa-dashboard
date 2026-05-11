-- ============================================================
-- 039_vendor_portal_upgrade.sql
-- Vendor Portal Upgrade: Bidding, Invoices, Availability, Performance
-- ============================================================

-- 1A. Feature flag + work_orders bidding column
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('vendor_portal_upgrade', false, 'Enable vendor bidding, invoices, availability, and performance scoring')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS bidding_open boolean DEFAULT false;

-- 1B. vendor_bids table
CREATE TABLE public.vendor_bids (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  vendor_id       uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  bid_amount      numeric NOT NULL CHECK (bid_amount >= 0),
  estimated_hours numeric CHECK (estimated_hours >= 0),
  proposed_start  date,
  notes           text,
  status          text NOT NULL DEFAULT 'Pending'
                  CHECK (status IN ('Pending', 'Accepted', 'Rejected', 'Withdrawn')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendor_bids_work_order ON public.vendor_bids (work_order_id);
CREATE INDEX idx_vendor_bids_vendor     ON public.vendor_bids (vendor_id);
CREATE INDEX idx_vendor_bids_status     ON public.vendor_bids (status) WHERE status = 'Pending';
CREATE UNIQUE INDEX idx_vendor_bids_unique_bid ON public.vendor_bids (work_order_id, vendor_id);

-- 1C. vendor_invoices table
CREATE TABLE public.vendor_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  vendor_id       uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  amount          numeric NOT NULL CHECK (amount > 0),
  description     text,
  line_items      jsonb DEFAULT '[]',
  file_url        text,
  file_name       text,
  status          text NOT NULL DEFAULT 'Submitted'
                  CHECK (status IN ('Submitted', 'Under Review', 'Approved', 'Rejected')),
  admin_notes     text,
  reviewed_by     uuid REFERENCES public.profiles(id),
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vendor_invoices_work_order ON public.vendor_invoices (work_order_id);
CREATE INDEX idx_vendor_invoices_vendor     ON public.vendor_invoices (vendor_id);
CREATE INDEX idx_vendor_invoices_status     ON public.vendor_invoices (status) WHERE status = 'Submitted';

-- 1D. vendor_availability + vendor_unavailable_dates
CREATE TABLE public.vendor_availability (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (end_time > start_time),
  UNIQUE (vendor_id, day_of_week, start_time)
);

CREATE INDEX idx_vendor_availability_vendor ON public.vendor_availability (vendor_id);

CREATE TABLE public.vendor_unavailable_dates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id   uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  date        date NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vendor_id, date)
);

CREATE INDEX idx_vendor_unavailable_vendor ON public.vendor_unavailable_dates (vendor_id);

-- 1E. vendor_reviews table
CREATE TABLE public.vendor_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  vendor_id       uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  rating          smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment         text,
  reviewed_by     uuid NOT NULL REFERENCES public.profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id)
);

CREATE INDEX idx_vendor_reviews_vendor ON public.vendor_reviews (vendor_id);

-- 1F. vendor_performance_summary view
CREATE OR REPLACE VIEW public.vendor_performance_summary AS
SELECT
  v.id AS vendor_id,
  v.company_name,
  v.contact_name,
  v.trade_type,
  v.hourly_rate,
  COUNT(DISTINCT wo.id) FILTER (WHERE wo.status IN ('Completed','Closed','Done'))
    AS total_completed_jobs,
  COUNT(DISTINCT wo.id) FILTER (WHERE wo.status IN ('Open','Assigned','In Progress'))
    AS active_jobs,
  ROUND(AVG(vr.rating)::numeric, 1) AS avg_rating,
  COUNT(DISTINCT vr.id) AS review_count,
  ROUND(
    100.0 * COUNT(DISTINCT wo.id) FILTER (
      WHERE wo.status IN ('Completed','Closed','Done')
    ) / NULLIF(COUNT(DISTINCT wo.id), 0),
    0
  ) AS completion_rate_pct
FROM public.vendors v
LEFT JOIN public.work_orders wo ON wo.vendor_id = v.id
LEFT JOIN public.vendor_reviews vr ON vr.vendor_id = v.id
WHERE v.do_not_use = false
GROUP BY v.id, v.company_name, v.contact_name, v.trade_type, v.hourly_rate;

-- ============================================================
-- 1G. RLS Policies
-- ============================================================

-- vendor_bids RLS
ALTER TABLE public.vendor_bids ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management manage vendor_bids"
  ON public.vendor_bids FOR ALL TO authenticated
  USING (is_management()) WITH CHECK (is_management());

CREATE POLICY "Vendors read own bids"
  ON public.vendor_bids FOR SELECT TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

CREATE POLICY "Vendors insert bids"
  ON public.vendor_bids FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

CREATE POLICY "Vendors update own bids"
  ON public.vendor_bids FOR UPDATE TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  )
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

-- vendor_invoices RLS
ALTER TABLE public.vendor_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management manage vendor_invoices"
  ON public.vendor_invoices FOR ALL TO authenticated
  USING (is_management()) WITH CHECK (is_management());

CREATE POLICY "Vendors read own invoices"
  ON public.vendor_invoices FOR SELECT TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

CREATE POLICY "Vendors insert invoices"
  ON public.vendor_invoices FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

-- vendor_availability RLS
ALTER TABLE public.vendor_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management read vendor_availability"
  ON public.vendor_availability FOR SELECT TO authenticated
  USING (is_management());

CREATE POLICY "Vendors manage own availability"
  ON public.vendor_availability FOR ALL TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  )
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

-- vendor_unavailable_dates RLS
ALTER TABLE public.vendor_unavailable_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management read vendor_unavailable_dates"
  ON public.vendor_unavailable_dates FOR SELECT TO authenticated
  USING (is_management());

CREATE POLICY "Vendors manage own unavailable_dates"
  ON public.vendor_unavailable_dates FOR ALL TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  )
  WITH CHECK (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

-- vendor_reviews RLS
ALTER TABLE public.vendor_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Management manage vendor_reviews"
  ON public.vendor_reviews FOR ALL TO authenticated
  USING (is_management()) WITH CHECK (is_management());

CREATE POLICY "Vendors read own reviews"
  ON public.vendor_reviews FOR SELECT TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND vendor_id IN (
      SELECT v.id FROM public.vendors v
      WHERE lower(v.email) = lower((SELECT email FROM auth.users WHERE id = auth.uid()))
    )
  );

-- Work orders: vendors can see open bidding work orders
CREATE POLICY "Vendors read biddable work_orders"
  ON public.work_orders FOR SELECT TO authenticated
  USING (
    get_my_role() = 'Vendor'
    AND status = 'Open'
    AND bidding_open = true
  );

-- Feature flags: vendors can read flags
CREATE POLICY "Vendors read feature_flags"
  ON public.feature_flags FOR SELECT TO authenticated
  USING (get_my_role() = 'Vendor');
