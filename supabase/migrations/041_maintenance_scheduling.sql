-- ============================================================
-- 041_maintenance_scheduling.sql
-- Maintenance Scheduling: Calendar view + date fields
-- ============================================================

-- 1A. Feature flag
INSERT INTO public.feature_flags (key, value, description) VALUES
  ('maintenance_calendar', true, 'Enable calendar view and scheduling on admin maintenance page')
ON CONFLICT (key) DO NOTHING;

-- 1B. Add scheduling columns to work_orders
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS due_date date;

-- 1C. Partial indexes for calendar range queries
CREATE INDEX IF NOT EXISTS idx_work_orders_scheduled_date
  ON public.work_orders (scheduled_date)
  WHERE scheduled_date IS NOT NULL AND archived = false;

CREATE INDEX IF NOT EXISTS idx_work_orders_due_date
  ON public.work_orders (due_date)
  WHERE due_date IS NOT NULL AND archived = false;

-- 1D. Constraint: due_date >= scheduled_date when both set
ALTER TABLE public.work_orders
  ADD CONSTRAINT chk_schedule_dates
  CHECK (
    due_date IS NULL
    OR scheduled_date IS NULL
    OR due_date >= scheduled_date
  );
