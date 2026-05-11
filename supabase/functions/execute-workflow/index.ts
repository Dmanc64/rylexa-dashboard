import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import {
  resolveEntityContext,
  substituteTemplate,
  evaluateCondition,
  type EntityContext,
  type ConditionConfig,
} from "../_shared/workflow-utils.ts";

/**
 * execute-workflow — Workflow automation engine.
 *
 * Three operating modes:
 *   - process_steps: Cron-triggered, processes scheduled step_runs (every 2 min)
 *   - evaluate_triggers: Cron-triggered, finds entities matching trigger conditions (every 15 min)
 *   - trigger: Webhook/manual, starts a specific workflow for a specific entity
 */

const MAX_RETRIES = 3;
const RETRY_DELAY_MIN = 5;
const STEP_BATCH_SIZE = 50;
const TIMEOUT_MS = 50_000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);
  const startTime = Date.now();

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // Check feature flag
    const { data: flag } = await supabase
      .from('feature_flags')
      .select('value')
      .eq('key', 'workflow_automation')
      .single();

    if (!flag?.value) {
      return new Response(
        JSON.stringify({ message: 'Workflow automation is disabled.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse mode from request body
    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      // No body = default to process_steps
    }

    const mode = (body.mode as string) || 'process_steps';

    let result: unknown;

    switch (mode) {
      case 'process_steps':
        result = await processScheduledSteps(supabase, startTime);
        break;
      case 'evaluate_triggers':
        result = await evaluateTriggers(supabase);
        break;
      case 'trigger':
        result = await triggerWorkflow(
          supabase,
          body.workflow_id as string,
          body.entity_type as string,
          body.entity_id as string,
          (body.context as Record<string, unknown>) || {}
        );
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown mode: ${mode}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

    return new Response(JSON.stringify({ success: true, mode, ...result as object }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('execute-workflow error:', error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// MODE A: Process Scheduled Steps (cron, every 2 min)
// ============================================================================

async function processScheduledSteps(
  supabase: ReturnType<typeof createClient>,
  startTime: number
) {
  const { data: pendingSteps, error } = await supabase
    .from('workflow_step_runs')
    .select(`
      id, workflow_run_id, workflow_step_id, step_order, status, retry_count,
      workflow_runs!inner(id, workflow_id, trigger_entity_type, trigger_entity_id, context, property_id)
    `)
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(STEP_BATCH_SIZE);

  if (error) throw error;
  if (!pendingSteps || pendingSteps.length === 0) {
    return { processed: 0, message: 'No scheduled steps to process' };
  }

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const stepRun of pendingSteps) {
    // Timeout guard
    if (Date.now() - startTime > TIMEOUT_MS) break;

    const run = (stepRun as any).workflow_runs;

    // Load step definition
    const { data: stepDef } = await supabase
      .from('workflow_steps')
      .select('step_type, step_config, condition_config')
      .eq('id', stepRun.workflow_step_id)
      .single();

    if (!stepDef) {
      await markStepFailed(supabase, stepRun.id, 'Step definition not found');
      failed++;
      continue;
    }

    // Mark as running
    await supabase
      .from('workflow_step_runs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', stepRun.id);

    try {
      // Resolve entity context (merge with stored run context)
      const entityCtx = await resolveEntityContext(
        supabase,
        run.trigger_entity_type,
        run.trigger_entity_id
      );
      const ctx: EntityContext = { ...entityCtx, ...(run.context || {}) };

      // Evaluate condition (skip if not met)
      if (stepDef.condition_config) {
        const condResult = evaluateCondition(stepDef.condition_config as ConditionConfig, ctx);
        const actionIfMatch = (stepDef.condition_config as ConditionConfig).action_if_match || 'skip_next';

        if (stepDef.step_type === 'condition') {
          if (condResult && actionIfMatch === 'skip_next') {
            // Condition met, skip the NEXT step
            await skipNextStep(supabase, stepRun.workflow_run_id, stepRun.step_order);
          }
          // Mark condition step as completed regardless
          await markStepCompleted(supabase, stepRun.id, { condition_result: condResult });
          completed++;
          await advanceWorkflow(supabase, stepRun.workflow_run_id, stepRun.step_order);
          continue;
        }
      }

      // Execute the step
      const result = await executeStepAction(supabase, stepDef.step_type, stepDef.step_config, ctx);

      // Mark completed
      await markStepCompleted(supabase, stepRun.id, result);
      completed++;

      // Advance workflow: schedule next step
      await advanceWorkflow(supabase, stepRun.workflow_run_id, stepRun.step_order);

    } catch (err) {
      const errMsg = (err as Error).message;
      console.error(`Step ${stepRun.id} failed:`, errMsg);

      if (stepRun.retry_count < MAX_RETRIES) {
        // Retry: reschedule
        const retryAt = new Date(Date.now() + RETRY_DELAY_MIN * 60_000).toISOString();
        await supabase
          .from('workflow_step_runs')
          .update({
            status: 'scheduled',
            scheduled_for: retryAt,
            retry_count: stepRun.retry_count + 1,
            error_message: errMsg,
          })
          .eq('id', stepRun.id);
      } else {
        await markStepFailed(supabase, stepRun.id, errMsg);
        // Mark the entire run as failed
        await supabase
          .from('workflow_runs')
          .update({ status: 'failed', completed_at: new Date().toISOString() })
          .eq('id', stepRun.workflow_run_id);
      }
      failed++;
    }
  }

  // Log batch summary
  await supabase.from('system_activity').insert({
    event_type: 'WORKFLOW_BATCH',
    title: 'Workflow steps processed',
    description: JSON.stringify({ completed, failed, skipped, total: pendingSteps.length }),
  });

  return { processed: pendingSteps.length, completed, failed, skipped };
}

// ============================================================================
// MODE B: Evaluate Triggers (cron, every 15 min)
// ============================================================================

async function evaluateTriggers(supabase: ReturnType<typeof createClient>) {
  // Get all active, non-template workflows with time-based triggers
  const { data: workflows } = await supabase
    .from('workflows')
    .select('id, trigger_type, trigger_config, property_id')
    .eq('is_active', true)
    .eq('is_template', false)
    .in('trigger_type', ['balance_overdue', 'lease_expiring', 'move_out_scheduled']);

  if (!workflows || workflows.length === 0) {
    return { evaluated: 0, started: 0 };
  }

  let started = 0;

  for (const wf of workflows) {
    const config = wf.trigger_config as Record<string, unknown>;
    let entities: Array<{ type: string; id: string }> = [];

    switch (wf.trigger_type) {
      case 'balance_overdue': {
        const daysOverdue = (config.days_overdue as number) || 5;
        const { data } = await supabase.rpc('get_delinquent_tenants');
        if (data) {
          // Filter to tenants overdue by at least N days
          const cutoff = new Date();
          cutoff.setDate(cutoff.getDate() - daysOverdue);
          entities = data
            .filter((t: any) => t.balance > 0)
            .map((t: any) => ({ type: 'tenant', id: t.tenant_id }));
        }
        break;
      }

      case 'lease_expiring': {
        const daysBefore = (config.days_before_expiry as number) || 90;
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysBefore);
        let query = supabase
          .from('leases')
          .select('id, tenant_id')
          .eq('status', 'Active')
          .not('end_date', 'is', null)
          .lte('end_date', futureDate.toISOString().split('T')[0]);

        if (wf.property_id) {
          query = query.eq('property_id', wf.property_id);
        }

        const { data } = await query;
        if (data) {
          entities = data.map((l: any) => ({ type: 'lease', id: l.id }));
        }
        break;
      }

      case 'move_out_scheduled': {
        const daysBefore = (config.days_before_moveout as number) || 14;
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + daysBefore);
        let query = supabase
          .from('leases')
          .select('id, unit_id')
          .eq('status', 'Active')
          .not('end_date', 'is', null)
          .lte('end_date', futureDate.toISOString().split('T')[0]);

        if (wf.property_id) {
          query = query.eq('property_id', wf.property_id);
        }

        const { data } = await query;
        if (data) {
          entities = data.map((l: any) => ({ type: 'lease', id: l.id }));
        }
        break;
      }
    }

    // Start runs for new entities (dedup handled by DB unique constraint)
    for (const entity of entities) {
      try {
        await supabase.rpc('start_workflow_run', {
          p_workflow_id: wf.id,
          p_entity_type: entity.type,
          p_entity_id: entity.id,
          p_context: '{}',
        });
        started++;
      } catch {
        // Unique constraint violation = already running, skip silently
      }
    }
  }

  return { evaluated: workflows.length, started };
}

// ============================================================================
// MODE C: Manual/Webhook Trigger
// ============================================================================

async function triggerWorkflow(
  supabase: ReturnType<typeof createClient>,
  workflowId: string,
  entityType: string,
  entityId: string,
  context: Record<string, unknown>
) {
  if (!workflowId || !entityType || !entityId) {
    throw new Error('workflow_id, entity_type, and entity_id are required');
  }

  const { data: runId, error } = await supabase.rpc('start_workflow_run', {
    p_workflow_id: workflowId,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_context: JSON.stringify(context),
  });

  if (error) throw error;
  return { run_id: runId };
}

// ============================================================================
// Step Executors
// ============================================================================

async function executeStepAction(
  supabase: ReturnType<typeof createClient>,
  stepType: string,
  stepConfig: Record<string, unknown>,
  ctx: EntityContext
): Promise<Record<string, unknown>> {
  switch (stepType) {
    case 'send_sms':
      return await executeSendSms(supabase, stepConfig, ctx);
    case 'send_email':
      return await executeSendEmail(supabase, stepConfig, ctx);
    case 'create_work_order':
      return await executeCreateWorkOrder(supabase, stepConfig, ctx);
    case 'update_status':
      return await executeUpdateStatus(supabase, stepConfig, ctx);
    case 'assign_vendor':
      return await executeAssignVendor(supabase, stepConfig, ctx);
    case 'add_charge':
      return await executeAddCharge(supabase, stepConfig, ctx);
    case 'create_task':
      return await executeCreateTask(supabase, stepConfig, ctx);
    case 'wait':
      return { action: 'wait', message: 'Delay step — no action needed' };
    default:
      throw new Error(`Unknown step type: ${stepType}`);
  }
}

// --- send_sms ---
async function executeSendSms(
  supabase: ReturnType<typeof createClient>,
  config: Record<string, unknown>,
  ctx: EntityContext
) {
  const recipientType = (config.recipient as string) || 'tenant';
  let phone = ctx.tenant_phone;

  if (recipientType === 'vendor' && ctx.work_order_id) {
    // Look up vendor phone from work order
    const { data: wo } = await supabase
      .from('work_orders')
      .select('vendor_id, vendors(phone)')
      .eq('id', ctx.work_order_id)
      .single();
    phone = (wo as any)?.vendors?.phone;
  }

  if (!phone) {
    return { action: 'send_sms', skipped: true, reason: 'No phone number' };
  }

  // Check notification preferences
  if (recipientType === 'tenant' && ctx.tenant_id) {
    const { data: pref } = await supabase
      .from('notification_preferences')
      .select('enabled')
      .eq('user_id', ctx.tenant_id)
      .eq('channel', 'sms')
      .maybeSingle();

    if (pref && pref.enabled === false) {
      return { action: 'send_sms', skipped: true, reason: 'SMS opt-out' };
    }
  }

  // Load template
  let body = (config.body as string) || '';
  if (config.template_slug) {
    const { data: template } = await supabase
      .from('sms_templates')
      .select('body')
      .eq('slug', config.template_slug)
      .eq('is_active', true)
      .single();
    if (template) body = template.body;
  }

  body = substituteTemplate(body, ctx);

  // Queue notification
  const { data: queued, error } = await supabase.from('notification_queue').insert({
    recipient_phone: phone,
    recipient_name: ctx.tenant_name,
    subject: substituteTemplate((config.subject as string) || 'Notification', ctx),
    body,
    channel: 'sms',
    status: 'pending',
  }).select('id').single();

  if (error) throw error;
  return { action: 'send_sms', notification_queue_id: queued?.id };
}

// --- send_email ---
async function executeSendEmail(
  supabase: ReturnType<typeof createClient>,
  config: Record<string, unknown>,
  ctx: EntityContext
) {
  const email = ctx.tenant_email;
  if (!email) {
    return { action: 'send_email', skipped: true, reason: 'No email address' };
  }

  const subject = substituteTemplate((config.subject as string) || 'Notification', ctx);
  const body = substituteTemplate((config.body as string) || (config.template as string) || '', ctx);

  const { data: queued, error } = await supabase.from('notification_queue').insert({
    recipient_email: email,
    recipient_name: ctx.tenant_name,
    subject,
    body,
    channel: 'email',
    status: 'pending',
  }).select('id').single();

  if (error) throw error;
  return { action: 'send_email', notification_queue_id: queued?.id };
}

// --- create_work_order ---
async function executeCreateWorkOrder(
  supabase: ReturnType<typeof createClient>,
  config: Record<string, unknown>,
  ctx: EntityContext
) {
  const title = substituteTemplate((config.title as string) || 'Auto-created work order', ctx);
  const description = substituteTemplate((config.description as string) || '', ctx);

  const { data: wo, error } = await supabase.from('work_orders').insert({
    title,
    description,
    unit_id: ctx.unit_id,
    priority: (config.priority as string) || 'Medium',
    category: (config.category as string) || 'General Maintenance',
    status: 'New',
  }).select('id').single();

  if (error) throw error;
  return { action: 'create_work_order', work_order_id: wo?.id };
}

// --- update_status ---
async function executeUpdateStatus(
  supabase: ReturnType<typeof createClient>,
  config: Record<string, unknown>,
  ctx: EntityContext
) {
  const targetStatus = config.status as string;
  const entityType = (config.entity_type as string) || 'work_order';

  let table: string;
  let entityId: string | undefined;

  switch (entityType) {
    case 'work_order':
      table = 'work_orders';
      entityId = ctx.work_order_id;
      break;
    case 'lease':
      table = 'leases';
      entityId = ctx.lease_id;
      break;
    default:
      throw new Error(`Cannot update status for entity type: ${entityType}`);
  }

  if (!entityId) {
    return { action: 'update_status', skipped: true, reason: `No ${entityType} in context` };
  }

  const { error } = await supabase
    .from(table)
    .update({ status: targetStatus })
    .eq('id', entityId);

  if (error) throw error;
  return { action: 'update_status', table, entity_id: entityId, new_status: targetStatus };
}

// --- assign_vendor ---
async function executeAssignVendor(
  supabase: ReturnType<typeof createClient>,
  config: Record<string, unknown>,
  ctx: EntityContext
) {
  if (!ctx.work_order_id) {
    return { action: 'assign_vendor', skipped: true, reason: 'No work order in context' };
  }

  const category = ctx.work_order_category || 'General Maintenance';

  // Category → trade_type mapping (same as triage-work-order)
  const CATEGORY_TO_TRADE: Record<string, string> = {
    'Plumbing': 'Plumbing',
    'Electrical': 'Electrical',
    'HVAC': 'HVAC',
    'Appliance': 'Appliances',
    'Structural': 'Repairs and Maintenance',
    'Pest Control': 'Pest Control',
    'Landscaping': 'Landscaping',
    'Safety': 'Fire',
    'General Maintenance': 'Handyperson',
  };

  const tradeType = CATEGORY_TO_TRADE[category] || 'Handyperson';

  const { data: vendor } = await supabase
    .from('vendors')
    .select('id, company_name')
    .eq('trade_type', tradeType)
    .eq('status', 'Active')
    .limit(1)
    .maybeSingle();

  if (!vendor) {
    return { action: 'assign_vendor', skipped: true, reason: `No active vendor for trade: ${tradeType}` };
  }

  const { error } = await supabase
    .from('work_orders')
    .update({ vendor_id: vendor.id, status: 'Assigned' })
    .eq('id', ctx.work_order_id);

  if (error) throw error;
  return { action: 'assign_vendor', vendor_id: vendor.id, vendor_name: vendor.company_name };
}

// --- add_charge ---
async function executeAddCharge(
  supabase: ReturnType<typeof createClient>,
  config: Record<string, unknown>,
  ctx: EntityContext
) {
  if (!ctx.lease_id) {
    return { action: 'add_charge', skipped: true, reason: 'No lease in context' };
  }

  let amount: number;
  const chargeType = (config.charge_type as string) || 'Late Fee';

  if (config.use_billing_settings) {
    // Use billing settings to calculate amount (same as apply-late-fees)
    const { data: settings } = await supabase
      .rpc('get_billing_settings', { p_property_id: ctx.property_id || null });

    const s = settings?.[0];
    if (!s) throw new Error('No billing settings found');

    if (s.late_fee_type === 'percent') {
      amount = ((ctx.balance_due || ctx.rent_amount || 0) * s.late_fee_amount) / 100;
    } else {
      amount = s.late_fee_amount;
    }
  } else {
    amount = (config.amount as number) || 0;
  }

  if (amount <= 0) {
    return { action: 'add_charge', skipped: true, reason: 'Amount is zero or negative' };
  }

  // Idempotency: check for existing charge this month
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { data: existing } = await supabase
    .from('accounting')
    .select('id')
    .eq('lease_id', ctx.lease_id)
    .eq('type', chargeType)
    .gte('created_at', monthStart.toISOString())
    .limit(1);

  if (existing && existing.length > 0) {
    return { action: 'add_charge', skipped: true, reason: 'Charge already exists this month' };
  }

  const { data, error } = await supabase.rpc('post_late_fee', {
    p_lease_id: ctx.lease_id,
    p_amount: amount,
  });

  if (error) throw error;
  return { action: 'add_charge', charge_type: chargeType, amount };
}

// --- create_task ---
async function executeCreateTask(
  supabase: ReturnType<typeof createClient>,
  config: Record<string, unknown>,
  ctx: EntityContext
) {
  const title = substituteTemplate((config.title as string) || 'Workflow task', ctx);
  const description = substituteTemplate((config.description as string) || '', ctx);
  const assigneeRole = (config.assignee_role as string) || 'Property Manager';

  const { error } = await supabase.from('system_activity').insert({
    event_type: 'WORKFLOW_TASK',
    title,
    description: JSON.stringify({
      task_description: description,
      assignee_role: assigneeRole,
      entity_type: ctx.work_order_id ? 'work_order' : ctx.lease_id ? 'lease' : 'tenant',
      entity_id: ctx.work_order_id || ctx.lease_id || ctx.tenant_id,
      property_id: ctx.property_id,
      property_name: ctx.property_name,
      created_by_workflow: true,
    }),
  });

  if (error) throw error;
  return { action: 'create_task', title, assignee_role: assigneeRole };
}

// ============================================================================
// Helper Functions
// ============================================================================

async function markStepCompleted(
  supabase: ReturnType<typeof createClient>,
  stepRunId: string,
  result: Record<string, unknown>
) {
  await supabase
    .from('workflow_step_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result,
    })
    .eq('id', stepRunId);
}

async function markStepFailed(
  supabase: ReturnType<typeof createClient>,
  stepRunId: string,
  errorMessage: string
) {
  await supabase
    .from('workflow_step_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: errorMessage,
    })
    .eq('id', stepRunId);
}

async function skipNextStep(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  currentOrder: number
) {
  await supabase
    .from('workflow_step_runs')
    .update({ status: 'skipped', completed_at: new Date().toISOString() })
    .eq('workflow_run_id', runId)
    .eq('step_order', currentOrder + 1);
}

async function advanceWorkflow(
  supabase: ReturnType<typeof createClient>,
  runId: string,
  completedOrder: number
) {
  // Schedule the next pending step
  const { data: nextStep } = await supabase
    .from('workflow_step_runs')
    .select('id, status')
    .eq('workflow_run_id', runId)
    .eq('step_order', completedOrder + 1)
    .maybeSingle();

  if (nextStep && nextStep.status === 'pending') {
    await supabase
      .from('workflow_step_runs')
      .update({ status: 'scheduled' })
      .eq('id', nextStep.id);

    // Update run's current step
    await supabase
      .from('workflow_runs')
      .update({ current_step_order: completedOrder + 1 })
      .eq('id', runId);
  } else if (!nextStep || nextStep.status === 'skipped') {
    // Check if there are more steps after the skipped one
    const { data: furtherSteps } = await supabase
      .from('workflow_step_runs')
      .select('id, step_order, status')
      .eq('workflow_run_id', runId)
      .gt('step_order', completedOrder + 1)
      .eq('status', 'pending')
      .order('step_order', { ascending: true })
      .limit(1);

    if (furtherSteps && furtherSteps.length > 0) {
      await supabase
        .from('workflow_step_runs')
        .update({ status: 'scheduled' })
        .eq('id', furtherSteps[0].id);

      await supabase
        .from('workflow_runs')
        .update({ current_step_order: furtherSteps[0].step_order })
        .eq('id', runId);
    } else {
      // No more steps — workflow complete
      await supabase
        .from('workflow_runs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', runId);
    }
  }
}
