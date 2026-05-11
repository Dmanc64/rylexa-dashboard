-- ============================================================================
-- Migration 059: Workflow Automation Engine
--
-- Creates the infrastructure for configurable multi-step workflow automation:
-- 1. workflows table (workflow definitions with trigger configuration)
-- 2. workflow_steps table (ordered steps within a workflow)
-- 3. workflow_runs table (execution tracking per entity)
-- 4. workflow_step_runs table (per-step execution records)
-- 5. start_workflow_run() RPC
-- 6. cancel_workflow_run() RPC
-- 7. RLS policies on all tables
-- 8. Indexes for query performance
-- 9. Audit triggers on workflow_runs
-- 10. Feature flag seed
-- 11. Pre-built workflow templates
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: workflows table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workflows (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name           text NOT NULL,
  description    text,
  trigger_type   text NOT NULL
                 CHECK (trigger_type IN (
                   'balance_overdue',
                   'lease_expiring',
                   'work_order_created',
                   'move_out_scheduled',
                   'manual'
                 )),
  trigger_config jsonb NOT NULL DEFAULT '{}',
  is_active      boolean NOT NULL DEFAULT false,
  property_id    uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  is_template    boolean NOT NULL DEFAULT false,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- ============================================================================
-- STEP 2: workflow_steps table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workflow_steps (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id      uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  step_order       integer NOT NULL,
  step_type        text NOT NULL
                   CHECK (step_type IN (
                     'send_sms',
                     'send_email',
                     'create_work_order',
                     'update_status',
                     'assign_vendor',
                     'add_charge',
                     'create_task',
                     'wait',
                     'condition'
                   )),
  step_config      jsonb NOT NULL DEFAULT '{}',
  delay_minutes    integer NOT NULL DEFAULT 0,
  condition_config jsonb,
  created_at       timestamptz DEFAULT now(),
  CONSTRAINT workflow_steps_order_unique UNIQUE (workflow_id, step_order)
);

-- ============================================================================
-- STEP 3: workflow_runs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workflow_runs (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id          uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  trigger_entity_type  text NOT NULL,
  trigger_entity_id    uuid NOT NULL,
  property_id          uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  status               text NOT NULL DEFAULT 'running'
                       CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  current_step_order   integer NOT NULL DEFAULT 1,
  context              jsonb NOT NULL DEFAULT '{}',
  started_at           timestamptz DEFAULT now(),
  completed_at         timestamptz,
  cancelled_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Prevent duplicate running workflows for the same entity
CREATE UNIQUE INDEX idx_workflow_runs_dedup
  ON public.workflow_runs (workflow_id, trigger_entity_id)
  WHERE status = 'running';

-- ============================================================================
-- STEP 4: workflow_step_runs table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.workflow_step_runs (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_run_id   uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  workflow_step_id  uuid NOT NULL REFERENCES public.workflow_steps(id) ON DELETE CASCADE,
  step_order        integer NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'scheduled', 'running', 'completed', 'failed', 'skipped')),
  scheduled_for     timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  result            jsonb,
  error_message     text,
  retry_count       integer NOT NULL DEFAULT 0
);

-- ============================================================================
-- STEP 5: RLS policies
-- ============================================================================

ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workflow_step_runs ENABLE ROW LEVEL SECURITY;

-- workflows: management can read/write
CREATE POLICY "Management read workflows"
  ON public.workflows FOR SELECT TO authenticated
  USING (public.is_management());

CREATE POLICY "Management insert workflows"
  ON public.workflows FOR INSERT TO authenticated
  WITH CHECK (public.is_management());

CREATE POLICY "Management update workflows"
  ON public.workflows FOR UPDATE TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Management delete workflows"
  ON public.workflows FOR DELETE TO authenticated
  USING (public.is_management());

-- workflow_steps: management can read/write
CREATE POLICY "Management read workflow_steps"
  ON public.workflow_steps FOR SELECT TO authenticated
  USING (public.is_management());

CREATE POLICY "Management insert workflow_steps"
  ON public.workflow_steps FOR INSERT TO authenticated
  WITH CHECK (public.is_management());

CREATE POLICY "Management update workflow_steps"
  ON public.workflow_steps FOR UPDATE TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

CREATE POLICY "Management delete workflow_steps"
  ON public.workflow_steps FOR DELETE TO authenticated
  USING (public.is_management());

-- workflow_runs: management can read and update (cancel)
CREATE POLICY "Management read workflow_runs"
  ON public.workflow_runs FOR SELECT TO authenticated
  USING (public.is_management());

CREATE POLICY "Management update workflow_runs"
  ON public.workflow_runs FOR UPDATE TO authenticated
  USING (public.is_management())
  WITH CHECK (public.is_management());

-- No INSERT policy for users — engine uses SECURITY DEFINER RPCs

-- workflow_step_runs: management can read
CREATE POLICY "Management read workflow_step_runs"
  ON public.workflow_step_runs FOR SELECT TO authenticated
  USING (public.is_management());

-- No INSERT/UPDATE policies for users — engine uses SECURITY DEFINER RPCs

-- ============================================================================
-- STEP 6: Indexes
-- ============================================================================

CREATE INDEX idx_workflows_property_id ON public.workflows (property_id);
CREATE INDEX idx_workflows_trigger_type ON public.workflows (trigger_type);
CREATE INDEX idx_workflows_active ON public.workflows (is_active) WHERE is_active = true;

CREATE INDEX idx_workflow_steps_workflow_id ON public.workflow_steps (workflow_id);

CREATE INDEX idx_workflow_runs_workflow_id ON public.workflow_runs (workflow_id);
CREATE INDEX idx_workflow_runs_status ON public.workflow_runs (status);
CREATE INDEX idx_workflow_runs_entity ON public.workflow_runs (trigger_entity_type, trigger_entity_id);

CREATE INDEX idx_workflow_step_runs_scheduled
  ON public.workflow_step_runs (scheduled_for)
  WHERE status = 'scheduled';

CREATE INDEX idx_workflow_step_runs_run_id ON public.workflow_step_runs (workflow_run_id);

-- ============================================================================
-- STEP 7: updated_at trigger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_workflows_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_workflows_updated_at
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.set_workflows_updated_at();

-- ============================================================================
-- STEP 8: start_workflow_run RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_workflow_run(
  p_workflow_id  uuid,
  p_entity_type  text,
  p_entity_id    uuid,
  p_context      jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run_id        uuid;
  v_property_id   uuid;
  v_step          record;
  v_cumulative_min integer := 0;
  v_base_time     timestamptz := now();
BEGIN
  -- Get property_id from the workflow
  SELECT w.property_id INTO v_property_id
  FROM public.workflows w
  WHERE w.id = p_workflow_id AND w.is_active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workflow not found or not active';
  END IF;

  -- Create the run
  INSERT INTO public.workflow_runs (
    workflow_id, trigger_entity_type, trigger_entity_id,
    property_id, status, current_step_order, context, started_at
  ) VALUES (
    p_workflow_id, p_entity_type, p_entity_id,
    v_property_id, 'running', 1, p_context, v_base_time
  )
  RETURNING id INTO v_run_id;

  -- Pre-create all step_runs with computed scheduled_for
  FOR v_step IN
    SELECT ws.id, ws.step_order, ws.delay_minutes
    FROM public.workflow_steps ws
    WHERE ws.workflow_id = p_workflow_id
    ORDER BY ws.step_order ASC
  LOOP
    v_cumulative_min := v_cumulative_min + v_step.delay_minutes;

    INSERT INTO public.workflow_step_runs (
      workflow_run_id, workflow_step_id, step_order,
      status, scheduled_for
    ) VALUES (
      v_run_id, v_step.id, v_step.step_order,
      CASE WHEN v_cumulative_min = 0 AND v_step.step_order = 1
           THEN 'scheduled' ELSE 'pending' END,
      v_base_time + (v_cumulative_min * interval '1 minute')
    );
  END LOOP;

  -- Schedule the first step immediately
  UPDATE public.workflow_step_runs
  SET status = 'scheduled'
  WHERE workflow_run_id = v_run_id AND step_order = 1;

  -- Log to system_activity
  INSERT INTO public.system_activity (event_type, title, description)
  VALUES (
    'WORKFLOW_START',
    'Workflow run started',
    format('Workflow %s started for %s %s', p_workflow_id, p_entity_type, p_entity_id)
  );

  RETURN v_run_id;
END;
$$;

-- ============================================================================
-- STEP 9: cancel_workflow_run RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_workflow_run(
  p_run_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Verify the run exists and is running
  IF NOT EXISTS (
    SELECT 1 FROM public.workflow_runs
    WHERE id = p_run_id AND status = 'running'
  ) THEN
    RAISE EXCEPTION 'Workflow run not found or not running';
  END IF;

  -- Cancel all pending/scheduled steps
  UPDATE public.workflow_step_runs
  SET status = 'skipped', completed_at = now()
  WHERE workflow_run_id = p_run_id
    AND status IN ('pending', 'scheduled');

  -- Cancel the run itself
  UPDATE public.workflow_runs
  SET status = 'cancelled',
      completed_at = now(),
      cancelled_by = auth.uid()
  WHERE id = p_run_id;

  -- Log
  INSERT INTO public.system_activity (event_type, title, description)
  VALUES (
    'WORKFLOW_CANCEL',
    'Workflow run cancelled',
    format('Run %s cancelled', p_run_id)
  );
END;
$$;

-- ============================================================================
-- STEP 10: Audit trigger on workflow_runs
-- ============================================================================

CREATE TRIGGER audit_workflow_runs
  AFTER INSERT OR UPDATE OR DELETE ON public.workflow_runs
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- ============================================================================
-- STEP 11: Feature flag
-- ============================================================================

INSERT INTO public.feature_flags (key, value, description)
VALUES ('workflow_automation', false, 'Enable configurable workflow automation engine')
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- STEP 12: Pre-built workflow templates
-- ============================================================================

-- Template 1: Collections Escalation
WITH wf AS (
  INSERT INTO public.workflows (name, description, trigger_type, trigger_config, is_active, is_template)
  VALUES (
    'Collections Escalation',
    'Automated collections sequence: SMS reminder → formal notice → late fee → collections referral',
    'balance_overdue',
    '{"days_overdue": 5}',
    false,
    true
  )
  RETURNING id
)
INSERT INTO public.workflow_steps (workflow_id, step_order, step_type, step_config, delay_minutes) VALUES
  ((SELECT id FROM wf), 1, 'send_sms',    '{"template_slug": "rent_reminder"}', 0),
  ((SELECT id FROM wf), 2, 'send_email',  '{"subject": "Formal Past Due Notice", "template": "formal_past_due"}', 14400),
  ((SELECT id FROM wf), 3, 'add_charge',  '{"charge_type": "Late Fee", "use_billing_settings": true}', 21600),
  ((SELECT id FROM wf), 4, 'create_task', '{"title": "Collections referral review", "assignee_role": "Property Manager"}', 21600);

-- Template 2: Lease Expiration Follow-up
WITH wf AS (
  INSERT INTO public.workflows (name, description, trigger_type, trigger_config, is_active, is_template)
  VALUES (
    'Lease Expiration Follow-up',
    'Renewal outreach sequence: renewal offer email → SMS reminder → manager follow-up task',
    'lease_expiring',
    '{"days_before_expiry": 90}',
    false,
    true
  )
  RETURNING id
)
INSERT INTO public.workflow_steps (workflow_id, step_order, step_type, step_config, delay_minutes) VALUES
  ((SELECT id FROM wf), 1, 'send_email',  '{"subject": "Lease Renewal Offer", "template": "renewal_offer"}', 0),
  ((SELECT id FROM wf), 2, 'send_sms',    '{"template_slug": "lease_expiry"}', 43200),
  ((SELECT id FROM wf), 3, 'create_task', '{"title": "Follow up on unsigned renewal", "assignee_role": "Property Manager"}', 43200);

-- Template 3: Move-Out Sequence
WITH wf AS (
  INSERT INTO public.workflows (name, description, trigger_type, trigger_config, is_active, is_template)
  VALUES (
    'Move-Out Sequence',
    'Move-out preparation: schedule inspection → create unit turn → security deposit reconciliation',
    'move_out_scheduled',
    '{"days_before_moveout": 14}',
    false,
    true
  )
  RETURNING id
)
INSERT INTO public.workflow_steps (workflow_id, step_order, step_type, step_config, delay_minutes) VALUES
  ((SELECT id FROM wf), 1, 'create_task',       '{"title": "Schedule move-out inspection", "assignee_role": "Property Manager"}', 0),
  ((SELECT id FROM wf), 2, 'create_work_order', '{"title": "Unit turn - {{unit_name}}", "use_turn_template": true}', 20160),
  ((SELECT id FROM wf), 3, 'create_task',       '{"title": "Post security deposit reconciliation", "assignee_role": "Accounting"}', 4320);

-- Template 4: New Work Order Routing
WITH wf AS (
  INSERT INTO public.workflows (name, description, trigger_type, trigger_config, is_active, is_template)
  VALUES (
    'New Work Order Routing',
    'Auto-route new work orders: AI triage → vendor assignment → vendor notification → escalation if unaccepted',
    'work_order_created',
    '{}',
    false,
    true
  )
  RETURNING id
)
INSERT INTO public.workflow_steps (workflow_id, step_order, step_type, step_config, delay_minutes) VALUES
  ((SELECT id FROM wf), 1, 'assign_vendor', '{"match_by": "trade_type", "use_ai_triage": true}', 0),
  ((SELECT id FROM wf), 2, 'send_sms',      '{"template_slug": "maintenance_update", "recipient": "vendor"}', 0),
  ((SELECT id FROM wf), 3, 'condition',      '{"check": "work_order_status", "expected": "Assigned", "action_if_match": "skip_next"}', 1440),
  ((SELECT id FROM wf), 4, 'create_task',   '{"title": "Escalate: vendor did not accept work order", "assignee_role": "Property Manager"}', 0);

COMMIT;
