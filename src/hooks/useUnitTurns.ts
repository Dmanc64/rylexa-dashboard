import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──────────────────────────────────────────────────

export type UnitTurn = {
  id: string
  unit_id: string
  property_id: string
  lease_id: string | null
  status: string
  move_out_date: string
  target_ready_date: string | null
  actual_ready_date: string | null
  template_id: string | null
  total_estimated_cost: number
  total_actual_cost: number
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined
  unit_name?: string
  property_name?: string
  tasks?: TurnTask[]
}

export type TurnTask = {
  id: string
  turn_id: string
  title: string
  category: string
  status: string
  sort_order: number
  vendor_id: string | null
  work_order_id: string | null
  estimated_cost: number
  actual_cost: number
  notes: string | null
  completed_at: string | null
  completed_by: string | null
  created_at: string
  // Joined
  vendor_name?: string
}

export type TurnTemplate = {
  id: string
  name: string
  description: string | null
  property_id: string | null
  tasks: { title: string; category: string; estimated_cost: number; sort_order: number }[]
  is_default: boolean
  created_by: string | null
  created_at: string
}

export type TurnSummary = {
  property_id: string
  property_name: string
  total_turns: number
  pending_turns: number
  active_turns: number
  completed_turns: number
  avg_turn_days: number | null
  avg_turn_cost: number | null
  completed_this_month: number
}

export type TurnFilters = {
  property_id?: string
  status?: string
}

// ── Constants ──────────────────────────────────────────────

export const TURN_STATUS_OPTIONS = [
  { value: 'Pending', label: 'Pending', color: 'bg-slate-100 text-slate-600' },
  { value: 'In Progress', label: 'In Progress', color: 'bg-blue-100 text-blue-700' },
  { value: 'Completed', label: 'Completed', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'Cancelled', label: 'Cancelled', color: 'bg-red-100 text-red-600' },
]

export const TASK_CATEGORY_OPTIONS = [
  { value: 'Cleaning', label: 'Cleaning', color: 'bg-cyan-100 text-cyan-700' },
  { value: 'Painting', label: 'Painting', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'Flooring', label: 'Flooring', color: 'bg-amber-100 text-amber-700' },
  { value: 'Appliances', label: 'Appliances', color: 'bg-slate-100 text-slate-700' },
  { value: 'Plumbing', label: 'Plumbing', color: 'bg-blue-100 text-blue-700' },
  { value: 'Electrical', label: 'Electrical', color: 'bg-orange-100 text-orange-700' },
  { value: 'HVAC', label: 'HVAC', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'General', label: 'General', color: 'bg-gray-100 text-gray-700' },
  { value: 'Inspection', label: 'Inspection', color: 'bg-violet-100 text-violet-700' },
  { value: 'Keys & Locks', label: 'Keys & Locks', color: 'bg-rose-100 text-rose-700' },
]

export const TASK_STATUS_OPTIONS = [
  { value: 'Pending', label: 'Pending' },
  { value: 'In Progress', label: 'In Progress' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Skipped', label: 'Skipped' },
]

// ── Fetch helpers ──────────────────────────────────────────

async function fetchUnitTurns(filters: TurnFilters): Promise<UnitTurn[]> {
  let query = supabase
    .from('unit_turns')
    .select(`
      *,
      units!unit_id ( name, properties!property_id ( name ) ),
      turn_tasks (
        *,
        vendors!vendor_id ( company_name )
      )
    `)
    .order('created_at', { ascending: false })

  if (filters.status) {
    query = query.eq('status', filters.status)
  }
  if (filters.property_id) {
    query = query.eq('property_id', filters.property_id)
  }

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((d: any) => ({
    ...d,
    unit_name: d.units?.name || 'Unknown',
    property_name: d.units?.properties?.name || 'Unknown',
    tasks: (d.turn_tasks ?? [])
      .map((t: any) => ({
        ...t,
        vendor_name: t.vendors?.company_name || null,
      }))
      .sort((a: any, b: any) => a.sort_order - b.sort_order),
  }))
}

async function fetchTurnTasks(turnId: string): Promise<TurnTask[]> {
  const { data, error } = await supabase
    .from('turn_tasks')
    .select(`
      *,
      vendors!vendor_id ( company_name )
    `)
    .eq('turn_id', turnId)
    .order('sort_order', { ascending: true })

  if (error) throw error

  return (data ?? []).map((t: any) => ({
    ...t,
    vendor_name: t.vendors?.company_name || null,
  }))
}

async function fetchTurnTemplates(): Promise<TurnTemplate[]> {
  const { data, error } = await supabase
    .from('turn_templates')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw error
  return (data ?? []) as TurnTemplate[]
}

async function fetchTurnSummary(): Promise<TurnSummary[]> {
  const { data, error } = await supabase
    .from('view_turn_summary')
    .select('*')

  if (error) throw error
  return (data ?? []) as TurnSummary[]
}

// ── Mutation helpers ───────────────────────────────────────

async function createTurnFromTemplate(payload: {
  unit_id: string
  property_id: string
  lease_id?: string
  template_id: string
  move_out_date: string
  target_ready_date?: string
  notes?: string
}) {
  const { data, error } = await supabase.rpc('create_turn_from_template', {
    p_unit_id: payload.unit_id,
    p_property_id: payload.property_id,
    p_lease_id: payload.lease_id ?? null,
    p_template_id: payload.template_id,
    p_move_out_date: payload.move_out_date,
    p_target_ready_date: payload.target_ready_date ?? null,
    p_notes: payload.notes ?? null,
  })
  if (error) throw error
  return data
}

async function updateTurn({ id, ...fields }: {
  id: string
  status?: string
  notes?: string
  target_ready_date?: string | null
}) {
  const update: Record<string, any> = {}
  if (fields.status !== undefined) update.status = fields.status
  if (fields.notes !== undefined) update.notes = fields.notes
  if (fields.target_ready_date !== undefined) update.target_ready_date = fields.target_ready_date

  if (Object.keys(update).length === 0) return

  const { error } = await supabase
    .from('unit_turns')
    .update(update)
    .eq('id', id)

  if (error) throw error
}

async function completeTurn(turnId: string) {
  const { data, error } = await supabase.rpc('complete_turn', {
    p_turn_id: turnId,
  })
  if (error) throw error
  return data
}

async function cancelTurn(turnId: string) {
  const { error } = await supabase
    .from('unit_turns')
    .update({ status: 'Cancelled' })
    .eq('id', turnId)

  if (error) throw error
}

async function addTask(payload: {
  turn_id: string
  title: string
  category: string
  sort_order?: number
  vendor_id?: string
  estimated_cost?: number
  notes?: string
}) {
  const { error } = await supabase
    .from('turn_tasks')
    .insert({
      turn_id: payload.turn_id,
      title: payload.title,
      category: payload.category,
      sort_order: payload.sort_order ?? 0,
      vendor_id: payload.vendor_id ?? null,
      estimated_cost: payload.estimated_cost ?? 0,
      notes: payload.notes ?? null,
    })

  if (error) throw error
}

async function completeTask(taskId: string) {
  const { data, error } = await supabase.rpc('complete_turn_task', {
    p_task_id: taskId,
  })
  if (error) throw error
  return data
}

async function skipTask(taskId: string) {
  const { error } = await supabase
    .from('turn_tasks')
    .update({ status: 'Skipped' })
    .eq('id', taskId)

  if (error) throw error
}

async function updateTask({ id, ...fields }: {
  id: string
  title?: string
  category?: string
  status?: string
  vendor_id?: string | null
  estimated_cost?: number
  actual_cost?: number
  notes?: string | null
  sort_order?: number
}) {
  const update: Record<string, any> = {}
  if (fields.title !== undefined) update.title = fields.title
  if (fields.category !== undefined) update.category = fields.category
  if (fields.status !== undefined) update.status = fields.status
  if (fields.vendor_id !== undefined) update.vendor_id = fields.vendor_id
  if (fields.estimated_cost !== undefined) update.estimated_cost = fields.estimated_cost
  if (fields.actual_cost !== undefined) update.actual_cost = fields.actual_cost
  if (fields.notes !== undefined) update.notes = fields.notes
  if (fields.sort_order !== undefined) update.sort_order = fields.sort_order

  if (Object.keys(update).length === 0) return

  const { error } = await supabase
    .from('turn_tasks')
    .update(update)
    .eq('id', id)

  if (error) throw error
}

async function createWorkOrderFromTask(taskId: string) {
  const { data, error } = await supabase.rpc('create_work_order_from_task', {
    p_task_id: taskId,
  })
  if (error) throw error
  return data
}

async function createTemplate(payload: {
  name: string
  description?: string
  property_id?: string
  tasks: { title: string; category: string; estimated_cost: number; sort_order: number }[]
  is_default?: boolean
}) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('turn_templates')
    .insert({
      name: payload.name,
      description: payload.description ?? null,
      property_id: payload.property_id ?? null,
      tasks: payload.tasks,
      is_default: payload.is_default ?? false,
      created_by: user.id,
    })

  if (error) throw error
}

async function updateTemplate({ id, ...fields }: {
  id: string
  name?: string
  description?: string | null
  property_id?: string | null
  tasks?: { title: string; category: string; estimated_cost: number; sort_order: number }[]
  is_default?: boolean
}) {
  const update: Record<string, any> = {}
  if (fields.name !== undefined) update.name = fields.name
  if (fields.description !== undefined) update.description = fields.description
  if (fields.property_id !== undefined) update.property_id = fields.property_id
  if (fields.tasks !== undefined) update.tasks = fields.tasks
  if (fields.is_default !== undefined) update.is_default = fields.is_default

  const { error } = await supabase
    .from('turn_templates')
    .update(update)
    .eq('id', id)

  if (error) throw error
}

async function deleteTemplate(templateId: string) {
  const { error } = await supabase
    .from('turn_templates')
    .delete()
    .eq('id', templateId)

  if (error) throw error
}

// ── Hooks ──────────────────────────────────────────────────

export function useUnitTurns(filters: TurnFilters = {}) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['unit-turns', filters],
    queryFn: () => fetchUnitTurns(filters),
  })

  const createMutation = useMutation({
    mutationFn: createTurnFromTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unit-turns'] })
      queryClient.invalidateQueries({ queryKey: ['turn-summary'] })
      toast.success('Unit turn created')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create unit turn'),
  })

  const updateMutation = useMutation({
    mutationFn: updateTurn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unit-turns'] })
      queryClient.invalidateQueries({ queryKey: ['turn-tasks'] })
      toast.success('Turn updated')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update turn'),
  })

  const completeMutation = useMutation({
    mutationFn: completeTurn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unit-turns'] })
      queryClient.invalidateQueries({ queryKey: ['turn-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['turn-summary'] })
      toast.success('Turn completed')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to complete turn'),
  })

  const cancelMutation = useMutation({
    mutationFn: cancelTurn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unit-turns'] })
      queryClient.invalidateQueries({ queryKey: ['turn-summary'] })
      toast.success('Turn cancelled')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to cancel turn'),
  })

  return {
    turns: data ?? [],
    loading: isLoading,
    createTurnFromTemplate: createMutation.mutateAsync,
    creating: createMutation.isPending,
    updateTurn: updateMutation.mutateAsync,
    updating: updateMutation.isPending,
    completeTurn: completeMutation.mutateAsync,
    completing: completeMutation.isPending,
    cancelTurn: cancelMutation.mutateAsync,
    cancelling: cancelMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['unit-turns'] }),
  }
}

// ── Turn Tasks hook ────────────────────────────────────────

export function useTurnTasks(turnId: string | null) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['turn-tasks', turnId],
    queryFn: () => fetchTurnTasks(turnId!),
    enabled: !!turnId,
  })

  const addMutation = useMutation({
    mutationFn: addTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['turn-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['unit-turns'] })
      toast.success('Task added')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to add task'),
  })

  const completeMutation = useMutation({
    mutationFn: completeTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['turn-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['unit-turns'] })
      queryClient.invalidateQueries({ queryKey: ['turn-summary'] })
      toast.success('Task completed')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to complete task'),
  })

  const skipMutation = useMutation({
    mutationFn: skipTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['turn-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['unit-turns'] })
      toast.success('Task skipped')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to skip task'),
  })

  const updateMutation = useMutation({
    mutationFn: updateTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['turn-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['unit-turns'] })
      toast.success('Task updated')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update task'),
  })

  const createWorkOrderMutation = useMutation({
    mutationFn: createWorkOrderFromTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['turn-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['unit-turns'] })
      queryClient.invalidateQueries({ queryKey: ['maintenance'] })
      toast.success('Work order created from task')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create work order'),
  })

  return {
    tasks: data ?? [],
    loading: isLoading,
    addTask: addMutation.mutateAsync,
    adding: addMutation.isPending,
    completeTask: completeMutation.mutateAsync,
    completing: completeMutation.isPending,
    skipTask: skipMutation.mutateAsync,
    skipping: skipMutation.isPending,
    updateTask: updateMutation.mutateAsync,
    updating: updateMutation.isPending,
    createWorkOrder: createWorkOrderMutation.mutateAsync,
    creatingWorkOrder: createWorkOrderMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['turn-tasks'] }),
  }
}

// ── Turn Templates hook ────────────────────────────────────

export function useTurnTemplates() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['turn-templates'],
    queryFn: fetchTurnTemplates,
  })

  const createMutation = useMutation({
    mutationFn: createTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['turn-templates'] })
      toast.success('Template created')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create template'),
  })

  const updateMutation = useMutation({
    mutationFn: updateTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['turn-templates'] })
      toast.success('Template updated')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update template'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['turn-templates'] })
      toast.success('Template deleted')
    },
    onError: (err: any) => toast.error(err.message || 'Failed to delete template'),
  })

  return {
    templates: data ?? [],
    loading: isLoading,
    createTemplate: createMutation.mutateAsync,
    creating: createMutation.isPending,
    updateTemplate: updateMutation.mutateAsync,
    updating: updateMutation.isPending,
    deleteTemplate: deleteMutation.mutateAsync,
    deleting: deleteMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['turn-templates'] }),
  }
}

// ── Turn Summary hook ──────────────────────────────────────

export function useTurnSummary() {
  const { data, isLoading } = useQuery({
    queryKey: ['turn-summary'],
    queryFn: fetchTurnSummary,
    staleTime: 30_000,
  })

  return {
    summary: data ?? [],
    loading: isLoading,
  }
}
