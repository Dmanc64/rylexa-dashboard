-- ============================================================================
-- Migration 052: Unit Turn Board / Turnover Management
--
-- Creates:
--   1. turn_templates — reusable turnover task checklists
--   2. unit_turns — one per turnover event
--   3. turn_tasks — individual tasks within a turn
--   4. view_turn_summary — KPI data (avg turn days, cost)
--   5. RPCs for creating turns from templates, completing tasks, linking WOs
--   6. Default "Standard Turn" template seed
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────
-- 1. turn_templates table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.turn_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  tasks       jsonb NOT NULL DEFAULT '[]',
  is_default  boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_turn_templates_property ON public.turn_templates(property_id);

COMMENT ON TABLE public.turn_templates IS 'Reusable turnover task checklists for unit turns';
COMMENT ON COLUMN public.turn_templates.tasks IS 'JSON array: [{title, category, estimated_cost, sort_order}]';

-- ────────────────────────────────────────────────────────────
-- 2. unit_turns table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.unit_turns (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id              uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  property_id          uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  lease_id             uuid REFERENCES public.leases(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Cancelled')),
  move_out_date        date NOT NULL,
  target_ready_date    date,
  actual_ready_date    date,
  template_id          uuid REFERENCES public.turn_templates(id) ON DELETE SET NULL,
  total_estimated_cost numeric(10,2) NOT NULL DEFAULT 0,
  total_actual_cost    numeric(10,2) NOT NULL DEFAULT 0,
  notes                text,
  created_by           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_unit_turns_unit ON public.unit_turns(unit_id);
CREATE INDEX IF NOT EXISTS idx_unit_turns_property ON public.unit_turns(property_id);
CREATE INDEX IF NOT EXISTS idx_unit_turns_status ON public.unit_turns(status);
CREATE INDEX IF NOT EXISTS idx_unit_turns_lease ON public.unit_turns(lease_id);

COMMENT ON TABLE public.unit_turns IS 'Tracks unit turnover events between tenants';

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_unit_turns_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_unit_turns_updated_at
  BEFORE UPDATE ON public.unit_turns
  FOR EACH ROW EXECUTE FUNCTION public.set_unit_turns_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. turn_tasks table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.turn_tasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id        uuid NOT NULL REFERENCES public.unit_turns(id) ON DELETE CASCADE,
  title          text NOT NULL,
  category       text NOT NULL
    CHECK (category IN ('Cleaning', 'Painting', 'Flooring', 'Appliances', 'Plumbing', 'Electrical', 'HVAC', 'General', 'Inspection', 'Keys & Locks')),
  status         text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Skipped')),
  sort_order     integer NOT NULL DEFAULT 0,
  vendor_id      uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  work_order_id  uuid REFERENCES public.work_orders(id) ON DELETE SET NULL,
  estimated_cost numeric(10,2) NOT NULL DEFAULT 0,
  actual_cost    numeric(10,2) NOT NULL DEFAULT 0,
  notes          text,
  completed_at   timestamptz,
  completed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_turn_tasks_turn ON public.turn_tasks(turn_id);
CREATE INDEX IF NOT EXISTS idx_turn_tasks_status ON public.turn_tasks(status);
CREATE INDEX IF NOT EXISTS idx_turn_tasks_vendor ON public.turn_tasks(vendor_id);
CREATE INDEX IF NOT EXISTS idx_turn_tasks_work_order ON public.turn_tasks(work_order_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_turn_tasks_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_turn_tasks_updated_at
  BEFORE UPDATE ON public.turn_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_turn_tasks_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. RLS policies
-- ────────────────────────────────────────────────────────────

-- turn_templates
ALTER TABLE public.turn_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY turn_templates_management_all
  ON public.turn_templates FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY turn_templates_staff_read
  ON public.turn_templates FOR SELECT
  TO authenticated
  USING (public.is_staff());

-- unit_turns
ALTER TABLE public.unit_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY unit_turns_management_all
  ON public.unit_turns FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY unit_turns_maintenance_read
  ON public.unit_turns FOR SELECT
  TO authenticated
  USING (
    (SELECT p.role FROM public.profiles p WHERE p.id = (SELECT auth.uid())) = 'Maintenance'
  );

-- turn_tasks
ALTER TABLE public.turn_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY turn_tasks_management_all
  ON public.turn_tasks FOR ALL
  TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY turn_tasks_maintenance_all
  ON public.turn_tasks FOR ALL
  TO authenticated
  USING (
    (SELECT p.role FROM public.profiles p WHERE p.id = (SELECT auth.uid())) = 'Maintenance'
  )
  WITH CHECK (
    (SELECT p.role FROM public.profiles p WHERE p.id = (SELECT auth.uid())) = 'Maintenance'
  );

CREATE POLICY turn_tasks_vendor_read
  ON public.turn_tasks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendors v
      WHERE v.id = turn_tasks.vendor_id
        AND lower(v.email) = lower(
          (SELECT au.email FROM auth.users au WHERE au.id = (SELECT auth.uid()))
        )
    )
  );

-- ────────────────────────────────────────────────────────────
-- 5. view_turn_summary — KPI dashboard
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.view_turn_summary AS
SELECT
  ut.property_id,
  p.name AS property_name,
  COUNT(*) AS total_turns,
  COUNT(*) FILTER (WHERE ut.status = 'Pending') AS pending_turns,
  COUNT(*) FILTER (WHERE ut.status = 'In Progress') AS active_turns,
  COUNT(*) FILTER (WHERE ut.status = 'Completed') AS completed_turns,
  ROUND(AVG(ut.actual_ready_date - ut.move_out_date) FILTER (WHERE ut.status = 'Completed'), 1) AS avg_turn_days,
  ROUND(AVG(ut.total_actual_cost) FILTER (WHERE ut.status = 'Completed'), 2) AS avg_turn_cost,
  COUNT(*) FILTER (WHERE ut.status = 'Completed' AND ut.actual_ready_date >= date_trunc('month', CURRENT_DATE)) AS completed_this_month
FROM public.unit_turns ut
JOIN public.properties p ON ut.property_id = p.id
GROUP BY ut.property_id, p.name;

-- ────────────────────────────────────────────────────────────
-- 6. create_turn_from_template() RPC
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_turn_from_template(
  p_unit_id        uuid,
  p_lease_id       uuid DEFAULT NULL,
  p_move_out_date  date DEFAULT CURRENT_DATE,
  p_template_id    uuid DEFAULT NULL,
  p_target_ready   date DEFAULT NULL,
  p_notes          text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_property_id uuid;
  v_turn_id     uuid;
  v_template    record;
  v_task        jsonb;
  v_total_est   numeric := 0;
  v_sort        integer := 0;
BEGIN
  -- Get property from unit
  SELECT property_id INTO v_property_id
  FROM public.units WHERE id = p_unit_id;

  IF v_property_id IS NULL THEN
    RAISE EXCEPTION 'Unit not found: %', p_unit_id;
  END IF;

  -- Create the turn
  INSERT INTO public.unit_turns (
    unit_id, property_id, lease_id, move_out_date,
    target_ready_date, template_id, notes, created_by
  ) VALUES (
    p_unit_id, v_property_id, p_lease_id, p_move_out_date,
    p_target_ready, p_template_id, p_notes, auth.uid()
  )
  RETURNING id INTO v_turn_id;

  -- Populate tasks from template if provided
  IF p_template_id IS NOT NULL THEN
    SELECT * INTO v_template
    FROM public.turn_templates WHERE id = p_template_id;

    IF v_template IS NOT NULL AND v_template.tasks IS NOT NULL THEN
      FOR v_task IN SELECT * FROM jsonb_array_elements(v_template.tasks)
      LOOP
        v_sort := v_sort + 1;
        INSERT INTO public.turn_tasks (
          turn_id, title, category, estimated_cost, sort_order
        ) VALUES (
          v_turn_id,
          v_task->>'title',
          v_task->>'category',
          COALESCE((v_task->>'estimated_cost')::numeric, 0),
          COALESCE((v_task->>'sort_order')::integer, v_sort)
        );
        v_total_est := v_total_est + COALESCE((v_task->>'estimated_cost')::numeric, 0);
      END LOOP;

      -- Update estimated total
      UPDATE public.unit_turns
      SET total_estimated_cost = v_total_est
      WHERE id = v_turn_id;
    END IF;
  END IF;

  RETURN v_turn_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. create_work_order_from_task() RPC
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_work_order_from_task(
  p_task_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task    record;
  v_turn    record;
  v_wo_id   uuid;
BEGIN
  SELECT * INTO v_task FROM public.turn_tasks WHERE id = p_task_id;
  IF v_task IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF v_task.work_order_id IS NOT NULL THEN RAISE EXCEPTION 'Task already linked to work order'; END IF;

  SELECT * INTO v_turn FROM public.unit_turns WHERE id = v_task.turn_id;

  INSERT INTO public.work_orders (
    title, description, category, priority, status,
    unit_id, vendor_id, assigned_to
  ) VALUES (
    'Turn: ' || v_task.title,
    'Unit turnover task — ' || v_task.category,
    v_task.category,
    'Normal',
    CASE WHEN v_task.vendor_id IS NOT NULL THEN 'Assigned' ELSE 'Open' END,
    v_turn.unit_id,
    v_task.vendor_id,
    NULL
  )
  RETURNING id INTO v_wo_id;

  UPDATE public.turn_tasks
  SET work_order_id = v_wo_id
  WHERE id = p_task_id;

  RETURN v_wo_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 8. complete_turn_task() RPC
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_turn_task(
  p_task_id     uuid,
  p_actual_cost numeric DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_turn_id uuid;
BEGIN
  UPDATE public.turn_tasks
  SET status = 'Completed',
      actual_cost = p_actual_cost,
      completed_at = now(),
      completed_by = auth.uid()
  WHERE id = p_task_id
  RETURNING turn_id INTO v_turn_id;

  IF v_turn_id IS NULL THEN
    RAISE EXCEPTION 'Task not found: %', p_task_id;
  END IF;

  -- Recalculate turn total
  UPDATE public.unit_turns
  SET total_actual_cost = (
    SELECT COALESCE(SUM(actual_cost), 0)
    FROM public.turn_tasks WHERE turn_id = v_turn_id
  )
  WHERE id = v_turn_id;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 9. complete_turn() RPC
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_turn(
  p_turn_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.unit_turns
  SET status = 'Completed',
      actual_ready_date = CURRENT_DATE
  WHERE id = p_turn_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Turn not found: %', p_turn_id;
  END IF;
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 10. Seed default turn template
-- ────────────────────────────────────────────────────────────
INSERT INTO public.turn_templates (name, description, is_default, tasks)
VALUES (
  'Standard Unit Turn',
  'Default turnover checklist for standard residential units',
  true,
  '[
    {"title": "Initial Inspection", "category": "Inspection", "estimated_cost": 0, "sort_order": 1},
    {"title": "Deep Clean", "category": "Cleaning", "estimated_cost": 200, "sort_order": 2},
    {"title": "Touch-Up Paint", "category": "Painting", "estimated_cost": 150, "sort_order": 3},
    {"title": "Carpet Clean / Replace", "category": "Flooring", "estimated_cost": 300, "sort_order": 4},
    {"title": "Check Appliances", "category": "Appliances", "estimated_cost": 0, "sort_order": 5},
    {"title": "Plumbing Check & Repair", "category": "Plumbing", "estimated_cost": 75, "sort_order": 6},
    {"title": "HVAC Filter & Check", "category": "HVAC", "estimated_cost": 50, "sort_order": 7},
    {"title": "Electrical Check", "category": "Electrical", "estimated_cost": 0, "sort_order": 8},
    {"title": "Rekey Locks", "category": "Keys & Locks", "estimated_cost": 75, "sort_order": 9},
    {"title": "Final Inspection", "category": "Inspection", "estimated_cost": 0, "sort_order": 10}
  ]'::jsonb
);

-- ────────────────────────────────────────────────────────────
-- 11. Feature flag
-- ────────────────────────────────────────────────────────────
INSERT INTO public.feature_flags (key, value, description)
VALUES ('unit_turns', true, 'Unit turnover board and task management')
ON CONFLICT (key) DO NOTHING;

COMMIT;
