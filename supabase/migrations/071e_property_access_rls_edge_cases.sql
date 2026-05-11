-- ============================================================================
-- Migration 071e: Tier 5 RLS Rewrite — Edge Cases
--
-- Tables in this migration each got an individual scoping decision:
--   1. bills              — hybrid: NULL property_id = admin/accounting;
--                            set = property-scoped
--   2. conversations      — drop overly-broad {public} mgmt policies;
--      conversation_participants    keep participant-scoped only
--      messages
--   3. workflows          — hybrid: NULL property_id = admin only;
--                            set = property-scoped
--   4. workflow_runs      — same hybrid as workflows
--   5. workflow_steps     — scope via parent workflow
--   6. workflow_step_runs — scope via parent workflow_run
--   7. leads              — property/unit-scoped (NULL on both = admin)
--   8. documents          — polymorphic, scoped by entity_type
--   9. tenant_statements  — lease-scoped
--   10. ai_drafts         — scoped via parent lead
--
-- Tables intentionally LEFT ALONE (already correctly scoped or system-wide):
--   vendors, audit_log, system_activity, login_audit, feature_flags,
--   ami_limits, rent_limits, sms_templates, syndication_channels,
--   turn_templates, report_exports, notification_queue,
--   notification_preferences, chat_messages, check_runs, check_run_bills.
--
-- check_runs and check_run_bills already use is_finance_reader() — that's the
-- right model for company-wide AP, so leave them.
-- ============================================================================

BEGIN;


-- ============================================================================
-- 1. BILLS — hybrid scope (nullable property_id)
-- ============================================================================

DROP POLICY IF EXISTS "bills_management_all"     ON public.bills;
DROP POLICY IF EXISTS "bills_accounting_read"    ON public.bills;
DROP POLICY IF EXISTS "bills_accounting_insert"  ON public.bills;
DROP POLICY IF EXISTS "bills_accounting_update"  ON public.bills;

CREATE POLICY "bills_scoped_read" ON public.bills
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (property_id IS NOT NULL AND property_id IN (SELECT public.user_property_ids()))
    OR (property_id IS NULL AND public.get_my_role() IN ('Property Manager', 'Accounting'))
  );

CREATE POLICY "bills_scoped_insert" ON public.bills
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_admin()
    OR (property_id IS NOT NULL AND public.user_can_post_financials(property_id))
    OR (property_id IS NULL AND public.get_my_role() IN ('Property Manager', 'Accounting'))
  );

CREATE POLICY "bills_scoped_update" ON public.bills
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR (property_id IS NOT NULL AND public.user_can_post_financials(property_id))
    OR (property_id IS NULL AND public.get_my_role() IN ('Property Manager', 'Accounting'))
  )
  WITH CHECK (
    public.is_admin()
    OR (property_id IS NOT NULL AND public.user_can_post_financials(property_id))
    OR (property_id IS NULL AND public.get_my_role() IN ('Property Manager', 'Accounting'))
  );

CREATE POLICY "bills_scoped_delete" ON public.bills
  FOR DELETE TO authenticated
  USING (
    public.is_admin()
    OR (property_id IS NOT NULL AND public.user_can_post_financials(property_id))
  );

-- Preserved: "bills_vendor_read" (vendor sees own bills)


-- ============================================================================
-- 2. CONVERSATIONS / CONVERSATION_PARTICIPANTS / MESSAGES
--    Drop the overly-broad {public}-role mgmt policies; keep participant-scoped.
-- ============================================================================

DROP POLICY IF EXISTS "management_full_conversations" ON public.conversations;
DROP POLICY IF EXISTS "management_full_participants"  ON public.conversation_participants;
DROP POLICY IF EXISTS "management_full_messages"      ON public.messages;

-- Add admin override (real admins still need to manage everything)
CREATE POLICY "conversations_admin_all" ON public.conversations
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "conversation_participants_admin_all" ON public.conversation_participants
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "messages_admin_all" ON public.messages
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Preserved (participant-scoped):
--   "users_select_own_participants", "users_update_own_participants"
--   "participants_select_conversations", "participants_update_conversations"
--   "participants_select_messages", "participants_insert_messages"


-- ============================================================================
-- 3. WORKFLOWS — hybrid (nullable property_id)
-- ============================================================================

DROP POLICY IF EXISTS "Management read workflows"   ON public.workflows;
DROP POLICY IF EXISTS "Management insert workflows" ON public.workflows;
DROP POLICY IF EXISTS "Management update workflows" ON public.workflows;
DROP POLICY IF EXISTS "Management delete workflows" ON public.workflows;

CREATE POLICY "workflows_scoped_read" ON public.workflows
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (property_id IS NOT NULL AND property_id IN (SELECT public.user_property_ids()))
    OR (property_id IS NULL AND public.get_my_role() IN ('Property Manager', 'Accounting'))
  );

CREATE POLICY "workflows_scoped_write" ON public.workflows
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR (property_id IS NOT NULL AND public.user_can_manage_property(property_id))
  )
  WITH CHECK (
    public.is_admin()
    OR (property_id IS NOT NULL AND public.user_can_manage_property(property_id))
  );


-- ============================================================================
-- 4. WORKFLOW_RUNS — same hybrid as workflows
-- ============================================================================

DROP POLICY IF EXISTS "Management read workflow_runs"   ON public.workflow_runs;
DROP POLICY IF EXISTS "Management update workflow_runs" ON public.workflow_runs;

CREATE POLICY "workflow_runs_scoped_read" ON public.workflow_runs
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (property_id IS NOT NULL AND property_id IN (SELECT public.user_property_ids()))
    OR (property_id IS NULL AND public.get_my_role() IN ('Property Manager', 'Accounting'))
  );

CREATE POLICY "workflow_runs_scoped_update" ON public.workflow_runs
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR (property_id IS NOT NULL AND public.user_can_manage_property(property_id))
  )
  WITH CHECK (
    public.is_admin()
    OR (property_id IS NOT NULL AND public.user_can_manage_property(property_id))
  );


-- ============================================================================
-- 5. WORKFLOW_STEPS — scope via parent workflow
-- ============================================================================

DROP POLICY IF EXISTS "Management read workflow_steps"   ON public.workflow_steps;
DROP POLICY IF EXISTS "Management insert workflow_steps" ON public.workflow_steps;
DROP POLICY IF EXISTS "Management update workflow_steps" ON public.workflow_steps;
DROP POLICY IF EXISTS "Management delete workflow_steps" ON public.workflow_steps;

CREATE POLICY "workflow_steps_scoped_read" ON public.workflow_steps
  FOR SELECT TO authenticated
  USING (workflow_id IN (SELECT id FROM public.workflows));

CREATE POLICY "workflow_steps_scoped_write" ON public.workflow_steps
  FOR ALL TO authenticated
  USING (
    workflow_id IN (
      SELECT id FROM public.workflows
      WHERE public.is_admin()
        OR (property_id IS NOT NULL AND public.user_can_manage_property(property_id))
    )
  )
  WITH CHECK (
    workflow_id IN (
      SELECT id FROM public.workflows
      WHERE public.is_admin()
        OR (property_id IS NOT NULL AND public.user_can_manage_property(property_id))
    )
  );


-- ============================================================================
-- 6. WORKFLOW_STEP_RUNS — scope via parent workflow_run
-- ============================================================================

DROP POLICY IF EXISTS "Management read workflow_step_runs" ON public.workflow_step_runs;

CREATE POLICY "workflow_step_runs_scoped_read" ON public.workflow_step_runs
  FOR SELECT TO authenticated
  USING (workflow_run_id IN (SELECT id FROM public.workflow_runs));


-- ============================================================================
-- 7. LEADS — property-scoped via interested_property_id / interested_unit_id
-- ============================================================================

DROP POLICY IF EXISTS "leads_management_all" ON public.leads;

CREATE POLICY "leads_scoped_read" ON public.leads
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR (interested_property_id IS NOT NULL AND interested_property_id IN (SELECT public.user_property_ids()))
    OR (interested_unit_id IS NOT NULL AND interested_unit_id IN (SELECT public.user_unit_ids()))
    OR (interested_property_id IS NULL AND interested_unit_id IS NULL
        AND public.get_my_role() IN ('Property Manager', 'Accounting'))
    OR assigned_to = (SELECT auth.uid())  -- the assignee can always see
  );

CREATE POLICY "leads_scoped_write" ON public.leads
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR (interested_property_id IS NOT NULL AND public.user_can_manage_property(interested_property_id))
    OR (interested_unit_id IS NOT NULL AND public.user_can_manage_unit(interested_unit_id))
    OR (interested_property_id IS NULL AND interested_unit_id IS NULL
        AND public.get_my_role() = 'Property Manager')
    OR assigned_to = (SELECT auth.uid())
  )
  WITH CHECK (
    public.is_admin()
    OR (interested_property_id IS NOT NULL AND public.user_can_manage_property(interested_property_id))
    OR (interested_unit_id IS NOT NULL AND public.user_can_manage_unit(interested_unit_id))
    OR (interested_property_id IS NULL AND interested_unit_id IS NULL
        AND public.get_my_role() = 'Property Manager')
    OR assigned_to = (SELECT auth.uid())
  );

-- Preserved: "leads_anon_insert" (public lead-capture form)


-- ============================================================================
-- 8. DOCUMENTS — polymorphic via (entity_type, entity_id)
-- ============================================================================

DROP POLICY IF EXISTS "Management full access to documents" ON public.documents;

CREATE POLICY "documents_scoped_read" ON public.documents
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR uploaded_by = (SELECT auth.uid())                                              -- author
    OR (entity_type = 'property'   AND entity_id IN (SELECT public.user_property_ids()))
    OR (entity_type = 'unit'       AND entity_id IN (SELECT public.user_unit_ids()))
    OR (entity_type = 'lease'      AND entity_id IN (SELECT public.user_lease_ids()))
    OR (entity_type = 'work_order' AND entity_id IN (SELECT id FROM public.work_orders))
  );

CREATE POLICY "documents_scoped_write" ON public.documents
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR uploaded_by = (SELECT auth.uid())
    OR (entity_type = 'property'   AND public.user_can_manage_property(entity_id))
    OR (entity_type = 'unit'       AND public.user_can_manage_unit(entity_id))
    OR (entity_type = 'lease'      AND public.user_can_manage_lease(entity_id))
  )
  WITH CHECK (
    public.is_admin()
    OR uploaded_by = (SELECT auth.uid())
    OR (entity_type = 'property'   AND public.user_can_manage_property(entity_id))
    OR (entity_type = 'unit'       AND public.user_can_manage_unit(entity_id))
    OR (entity_type = 'lease'      AND public.user_can_manage_lease(entity_id))
  );

-- Preserved (relationship-shared documents):
--   "Owners read shared documents", "Tenants read shared documents", "Vendors read shared documents"


-- ============================================================================
-- 9. TENANT_STATEMENTS — lease-scoped
-- ============================================================================

DROP POLICY IF EXISTS "Management can manage all statements" ON public.tenant_statements;

CREATE POLICY "tenant_statements_scoped_read" ON public.tenant_statements
  FOR SELECT TO authenticated
  USING (lease_id IN (SELECT public.user_lease_ids()));

CREATE POLICY "tenant_statements_scoped_write" ON public.tenant_statements
  FOR ALL TO authenticated
  USING (
    lease_id IN (SELECT public.user_lease_ids())
    AND public.user_can_manage_lease(lease_id)
  )
  WITH CHECK (
    lease_id IN (SELECT public.user_lease_ids())
    AND public.user_can_manage_lease(lease_id)
  );

-- Preserved: "Tenants can read own statements"


-- ============================================================================
-- 10. AI_DRAFTS — scope via parent lead
-- ============================================================================

DROP POLICY IF EXISTS "ai_drafts_management_all" ON public.ai_drafts;

CREATE POLICY "ai_drafts_scoped_read" ON public.ai_drafts
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR generated_by = (SELECT auth.uid())
    OR lead_id IN (SELECT id FROM public.leads)   -- inherits leads RLS
  );

CREATE POLICY "ai_drafts_scoped_write" ON public.ai_drafts
  FOR ALL TO authenticated
  USING (
    public.is_admin()
    OR generated_by = (SELECT auth.uid())
    OR lead_id IN (SELECT id FROM public.leads)
  )
  WITH CHECK (
    public.is_admin()
    OR generated_by = (SELECT auth.uid())
    OR lead_id IN (SELECT id FROM public.leads)
  );

COMMIT;
