import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ============================================================================
// Types
// ============================================================================

export type TriggerType =
  | 'balance_overdue'
  | 'lease_expiring'
  | 'work_order_created'
  | 'move_out_scheduled'
  | 'manual'

export type StepType =
  | 'send_sms'
  | 'send_email'
  | 'create_work_order'
  | 'update_status'
  | 'assign_vendor'
  | 'add_charge'
  | 'create_task'
  | 'wait'
  | 'condition'

export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export type StepRunStatus = 'pending' | 'scheduled' | 'running' | 'completed' | 'failed' | 'skipped'

export type Workflow = {
  id: string
  name: string
  description: string | null
  trigger_type: TriggerType
  trigger_config: Record<string, unknown>
  is_active: boolean
  property_id: string | null
  is_template: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  // joined
  property_name?: string
  step_count?: number
  run_count?: number
  last_run_at?: string
}

export type WorkflowStep = {
  id: string
  workflow_id: string
  step_order: number
  step_type: StepType
  step_config: Record<string, unknown>
  delay_minutes: number
  condition_config: Record<string, unknown> | null
  created_at: string
}

export type WorkflowRun = {
  id: string
  workflow_id: string
  trigger_entity_type: string
  trigger_entity_id: string
  property_id: string | null
  status: WorkflowRunStatus
  current_step_order: number
  context: Record<string, unknown>
  started_at: string
  completed_at: string | null
  cancelled_by: string | null
}

export type WorkflowStepRun = {
  id: string
  workflow_run_id: string
  workflow_step_id: string
  step_order: number
  status: StepRunStatus
  scheduled_for: string | null
  started_at: string | null
  completed_at: string | null
  result: Record<string, unknown> | null
  error_message: string | null
  retry_count: number
}

// ============================================================================
// Trigger type display helpers
// ============================================================================

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  balance_overdue: 'Balance Overdue',
  lease_expiring: 'Lease Expiring',
  work_order_created: 'Work Order Created',
  move_out_scheduled: 'Move-Out Scheduled',
  manual: 'Manual Trigger',
}

export const STEP_TYPE_LABELS: Record<StepType, string> = {
  send_sms: 'Send SMS',
  send_email: 'Send Email',
  create_work_order: 'Create Work Order',
  update_status: 'Update Status',
  assign_vendor: 'Assign Vendor',
  add_charge: 'Add Charge',
  create_task: 'Create Task',
  wait: 'Wait / Delay',
  condition: 'Condition Check',
}

// ============================================================================
// useWorkflows — list all workflows
// ============================================================================

export function useWorkflows(propertyFilter?: string | null) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['workflows', propertyFilter],
    queryFn: async () => {
      let query = supabase
        .from('workflows')
        .select(`
          *,
          properties(name),
          workflow_steps(id),
          workflow_runs(id, started_at)
        `)
        .order('created_at', { ascending: false })

      if (propertyFilter) {
        query = query.eq('property_id', propertyFilter)
      }

      const { data, error } = await query
      if (error) throw error

      return (data || []).map((w: any) => ({
        ...w,
        property_name: w.properties?.name || null,
        step_count: w.workflow_steps?.length || 0,
        run_count: w.workflow_runs?.length || 0,
        last_run_at: w.workflow_runs?.[0]?.started_at || null,
        // Clean up joined fields
        properties: undefined,
        workflow_steps: undefined,
        workflow_runs: undefined,
      })) as Workflow[]
    },
  })

  return {
    workflows: data ?? [],
    loading: isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
  }
}

// ============================================================================
// useWorkflowDetail — single workflow + steps
// ============================================================================

export function useWorkflowDetail(workflowId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-detail', workflowId],
    queryFn: async () => {
      if (!workflowId) return null

      const [wfRes, stepsRes] = await Promise.all([
        supabase
          .from('workflows')
          .select('*, properties(name)')
          .eq('id', workflowId)
          .single(),
        supabase
          .from('workflow_steps')
          .select('*')
          .eq('workflow_id', workflowId)
          .order('step_order', { ascending: true }),
      ])

      if (wfRes.error) throw wfRes.error
      if (stepsRes.error) throw stepsRes.error

      return {
        workflow: {
          ...wfRes.data,
          property_name: (wfRes.data as any).properties?.name || null,
        } as Workflow,
        steps: (stepsRes.data || []) as WorkflowStep[],
      }
    },
    enabled: !!workflowId,
  })

  return {
    workflow: data?.workflow ?? null,
    steps: data?.steps ?? [],
    loading: isLoading,
  }
}

// ============================================================================
// useWorkflowRuns — run history for a workflow
// ============================================================================

export function useWorkflowRuns(workflowId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-runs', workflowId],
    queryFn: async () => {
      if (!workflowId) return []
      const { data, error } = await supabase
        .from('workflow_runs')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('started_at', { ascending: false })
        .limit(100)

      if (error) throw error
      return (data || []) as WorkflowRun[]
    },
    enabled: !!workflowId,
  })

  return { runs: data ?? [], loading: isLoading }
}

// ============================================================================
// useWorkflowStepRuns — step execution log for a run
// ============================================================================

export function useWorkflowStepRuns(runId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-step-runs', runId],
    queryFn: async () => {
      if (!runId) return []
      const { data, error } = await supabase
        .from('workflow_step_runs')
        .select('*')
        .eq('workflow_run_id', runId)
        .order('step_order', { ascending: true })

      if (error) throw error
      return (data || []) as WorkflowStepRun[]
    },
    enabled: !!runId,
  })

  return { stepRuns: data ?? [], loading: isLoading }
}

// ============================================================================
// useWorkflowMutations — all write operations
// ============================================================================

export function useWorkflowMutations() {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['workflows'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-detail'] })
    queryClient.invalidateQueries({ queryKey: ['workflow-runs'] })
  }

  // Create workflow
  const createWorkflow = useMutation({
    mutationFn: async (input: {
      name: string
      description?: string
      trigger_type: TriggerType
      trigger_config?: Record<string, unknown>
      property_id?: string | null
    }) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('workflows')
        .insert({
          name: input.name,
          description: input.description || null,
          trigger_type: input.trigger_type,
          trigger_config: input.trigger_config || {},
          property_id: input.property_id || null,
          is_template: false,
          is_active: false,
          created_by: user?.id || null,
        })
        .select('id')
        .single()

      if (error) throw error
      return data.id as string
    },
    onSuccess: () => {
      toast.success('Workflow created')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to create workflow: ${err.message}`),
  })

  // Create from template
  const createFromTemplate = useMutation({
    mutationFn: async (input: {
      templateId: string
      name?: string
      property_id?: string | null
    }) => {
      // Load template + steps
      const [wfRes, stepsRes] = await Promise.all([
        supabase.from('workflows').select('*').eq('id', input.templateId).single(),
        supabase.from('workflow_steps').select('*').eq('workflow_id', input.templateId).order('step_order'),
      ])

      if (wfRes.error) throw wfRes.error
      if (stepsRes.error) throw stepsRes.error

      const template = wfRes.data
      const { data: { user } } = await supabase.auth.getUser()

      // Create new workflow from template
      const { data: newWf, error: wfErr } = await supabase
        .from('workflows')
        .insert({
          name: input.name || `${template.name} (copy)`,
          description: template.description,
          trigger_type: template.trigger_type,
          trigger_config: template.trigger_config,
          property_id: input.property_id || null,
          is_template: false,
          is_active: false,
          created_by: user?.id || null,
        })
        .select('id')
        .single()

      if (wfErr) throw wfErr

      // Copy steps
      if (stepsRes.data && stepsRes.data.length > 0) {
        const stepInserts = stepsRes.data.map((s: any) => ({
          workflow_id: newWf.id,
          step_order: s.step_order,
          step_type: s.step_type,
          step_config: s.step_config,
          delay_minutes: s.delay_minutes,
          condition_config: s.condition_config,
        }))

        const { error: stepErr } = await supabase.from('workflow_steps').insert(stepInserts)
        if (stepErr) throw stepErr
      }

      return newWf.id as string
    },
    onSuccess: () => {
      toast.success('Workflow created from template')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to create from template: ${err.message}`),
  })

  // Update workflow
  const updateWorkflow = useMutation({
    mutationFn: async (input: { id: string } & Partial<Omit<Workflow, 'id' | 'created_at' | 'updated_at'>>) => {
      const { id, ...changes } = input
      const { error } = await supabase.from('workflows').update(changes).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Workflow updated')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to update: ${err.message}`),
  })

  // Delete workflow
  const deleteWorkflow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('workflows').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Workflow deleted')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to delete: ${err.message}`),
  })

  // Toggle active
  const toggleWorkflow = useMutation({
    mutationFn: async (input: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from('workflows')
        .update({ is_active: input.is_active })
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: (_, vars) => {
      toast.success(vars.is_active ? 'Workflow activated' : 'Workflow paused')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to toggle: ${err.message}`),
  })

  // Add step
  const addStep = useMutation({
    mutationFn: async (input: {
      workflow_id: string
      step_order: number
      step_type: StepType
      step_config?: Record<string, unknown>
      delay_minutes?: number
      condition_config?: Record<string, unknown> | null
    }) => {
      // Shift existing steps at or after this position
      const { data: existingSteps } = await supabase
        .from('workflow_steps')
        .select('id, step_order')
        .eq('workflow_id', input.workflow_id)
        .gte('step_order', input.step_order)
        .order('step_order', { ascending: false })

      if (existingSteps) {
        for (const s of existingSteps) {
          await supabase
            .from('workflow_steps')
            .update({ step_order: s.step_order + 1 })
            .eq('id', s.id)
        }
      }

      const { data, error } = await supabase
        .from('workflow_steps')
        .insert({
          workflow_id: input.workflow_id,
          step_order: input.step_order,
          step_type: input.step_type,
          step_config: input.step_config || {},
          delay_minutes: input.delay_minutes || 0,
          condition_config: input.condition_config || null,
        })
        .select('id')
        .single()

      if (error) throw error
      return data.id
    },
    onSuccess: () => {
      toast.success('Step added')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to add step: ${err.message}`),
  })

  // Update step
  const updateStep = useMutation({
    mutationFn: async (input: { id: string } & Partial<Omit<WorkflowStep, 'id' | 'workflow_id' | 'created_at'>>) => {
      const { id, ...changes } = input
      const { error } = await supabase.from('workflow_steps').update(changes).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Step updated')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to update step: ${err.message}`),
  })

  // Remove step
  const removeStep = useMutation({
    mutationFn: async (input: { id: string; workflow_id: string; step_order: number }) => {
      const { error } = await supabase.from('workflow_steps').delete().eq('id', input.id)
      if (error) throw error

      // Reorder remaining steps
      const { data: remaining } = await supabase
        .from('workflow_steps')
        .select('id, step_order')
        .eq('workflow_id', input.workflow_id)
        .gt('step_order', input.step_order)
        .order('step_order', { ascending: true })

      if (remaining) {
        for (const s of remaining) {
          await supabase
            .from('workflow_steps')
            .update({ step_order: s.step_order - 1 })
            .eq('id', s.id)
        }
      }
    },
    onSuccess: () => {
      toast.success('Step removed')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to remove step: ${err.message}`),
  })

  // Cancel run
  const cancelRun = useMutation({
    mutationFn: async (runId: string) => {
      const { error } = await supabase.rpc('cancel_workflow_run', { p_run_id: runId })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Workflow run cancelled')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to cancel: ${err.message}`),
  })

  // Trigger manual
  const triggerManual = useMutation({
    mutationFn: async (input: {
      workflow_id: string
      entity_type: string
      entity_id: string
      context?: Record<string, unknown>
    }) => {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/execute-workflow`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({
            mode: 'trigger',
            workflow_id: input.workflow_id,
            entity_type: input.entity_type,
            entity_id: input.entity_id,
            context: input.context || {},
          }),
        }
      )

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to trigger workflow')
      }

      return res.json()
    },
    onSuccess: () => {
      toast.success('Workflow triggered')
      invalidate()
    },
    onError: (err) => toast.error(`Failed to trigger: ${err.message}`),
  })

  return {
    createWorkflow,
    createFromTemplate,
    updateWorkflow,
    deleteWorkflow,
    toggleWorkflow,
    addStep,
    updateStep,
    removeStep,
    cancelRun,
    triggerManual,
  }
}
