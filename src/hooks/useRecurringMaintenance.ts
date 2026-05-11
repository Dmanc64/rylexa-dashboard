import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──────────────────────────────────────────────────

export type RecurringFrequency =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'quarterly'
  | 'semi_annual'
  | 'annual'

export type RecurringPriority = 'Low' | 'Normal' | 'High' | 'Emergency'

export type RecurringTask = {
  id: string
  property_id: string
  unit_id: string | null
  title: string
  description: string | null
  category: string | null
  priority: RecurringPriority
  frequency: RecurringFrequency
  next_due_date: string
  last_generated_at: string | null
  assigned_vendor_id: string | null
  is_active: boolean
  created_by: string
  created_at: string
  // Joined
  property_name?: string
  unit_name?: string | null
  vendor_name?: string | null
}

export type CreateRecurringTaskPayload = {
  property_id: string
  unit_id?: string | null
  title: string
  description?: string | null
  category?: string | null
  priority: RecurringPriority
  frequency: RecurringFrequency
  next_due_date: string
  assigned_vendor_id?: string | null
}

export type UpdateRecurringTaskPayload = Partial<CreateRecurringTaskPayload> & {
  id: string
}

// ── Constants ──────────────────────────────────────────────

export const FREQUENCY_OPTIONS: { value: RecurringFrequency; label: string; color: string }[] = [
  { value: 'weekly', label: 'Weekly', color: 'violet' },
  { value: 'biweekly', label: 'Biweekly', color: 'blue' },
  { value: 'monthly', label: 'Monthly', color: 'emerald' },
  { value: 'quarterly', label: 'Quarterly', color: 'amber' },
  { value: 'semi_annual', label: 'Semi-Annual', color: 'orange' },
  { value: 'annual', label: 'Annual', color: 'slate' },
]

export const PRIORITY_OPTIONS: { value: RecurringPriority; label: string; color: string }[] = [
  { value: 'Low', label: 'Low', color: 'slate' },
  { value: 'Normal', label: 'Normal', color: 'blue' },
  { value: 'High', label: 'High', color: 'amber' },
  { value: 'Emergency', label: 'Emergency', color: 'red' },
]

// ── Fetch helpers ──────────────────────────────────────────

async function fetchRecurringTasks(): Promise<RecurringTask[]> {
  const { data, error } = await supabase
    .from('recurring_maintenance')
    .select(`
      *,
      properties!property_id ( name ),
      units!unit_id ( name ),
      vendors!assigned_vendor_id ( company_name, contact_name )
    `)
    .order('next_due_date', { ascending: true })

  if (error) throw error

  return (data ?? []).map((t: any) => ({
    ...t,
    property_name: t.properties?.name || 'Unknown',
    unit_name: t.units?.name || null,
    vendor_name: t.vendors?.company_name || t.vendors?.contact_name || null,
  }))
}

async function createRecurringTask(payload: CreateRecurringTaskPayload) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data, error } = await supabase
    .from('recurring_maintenance')
    .insert({
      property_id: payload.property_id,
      unit_id: payload.unit_id || null,
      title: payload.title,
      description: payload.description?.trim() || null,
      category: payload.category?.trim() || null,
      priority: payload.priority,
      frequency: payload.frequency,
      next_due_date: payload.next_due_date,
      assigned_vendor_id: payload.assigned_vendor_id || null,
      is_active: true,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (error) throw new Error('Failed to create recurring task: ' + error.message)
  return data.id as string
}

async function updateRecurringTask({ id, ...changes }: UpdateRecurringTaskPayload) {
  const updates: Record<string, any> = {}

  if (changes.title !== undefined) updates.title = changes.title
  if (changes.description !== undefined) updates.description = changes.description?.trim() || null
  if (changes.category !== undefined) updates.category = changes.category?.trim() || null
  if (changes.property_id !== undefined) updates.property_id = changes.property_id
  if (changes.unit_id !== undefined) updates.unit_id = changes.unit_id || null
  if (changes.priority !== undefined) updates.priority = changes.priority
  if (changes.frequency !== undefined) updates.frequency = changes.frequency
  if (changes.next_due_date !== undefined) updates.next_due_date = changes.next_due_date
  if (changes.assigned_vendor_id !== undefined) updates.assigned_vendor_id = changes.assigned_vendor_id || null

  const { error } = await supabase
    .from('recurring_maintenance')
    .update(updates)
    .eq('id', id)

  if (error) throw new Error('Failed to update recurring task: ' + error.message)
}

async function toggleTaskActive({ id, is_active }: { id: string; is_active: boolean }) {
  const { error } = await supabase
    .from('recurring_maintenance')
    .update({ is_active })
    .eq('id', id)

  if (error) throw new Error('Failed to toggle task: ' + error.message)
}

async function generateWorkOrders(): Promise<{ generated: number; skipped: number }> {
  const { data, error } = await supabase.rpc('generate_recurring_work_orders')

  if (error) throw new Error('Failed to generate work orders: ' + error.message)
  return data as { generated: number; skipped: number }
}

async function deleteRecurringTask(id: string) {
  const { error } = await supabase
    .from('recurring_maintenance')
    .delete()
    .eq('id', id)

  if (error) throw new Error('Failed to delete recurring task: ' + error.message)
}

// ── Hook ───────────────────────────────────────────────────

export function useRecurringMaintenance() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['recurring-maintenance'],
    queryFn: fetchRecurringTasks,
  })

  const createMutation = useMutation({
    mutationFn: createRecurringTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-maintenance'] })
      toast.success('Recurring task created')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: updateRecurringTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-maintenance'] })
      toast.success('Recurring task updated')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleMutation = useMutation({
    mutationFn: toggleTaskActive,
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ['recurring-maintenance'] })
      toast.success(vars.is_active ? 'Task activated' : 'Task paused')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const generateMutation = useMutation({
    mutationFn: generateWorkOrders,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['recurring-maintenance'] })
      queryClient.invalidateQueries({ queryKey: ['maintenance'] })
      if (result.generated > 0) {
        toast.success(`Generated ${result.generated} work order${result.generated !== 1 ? 's' : ''}, skipped ${result.skipped}`)
      } else {
        toast.info(`No work orders due yet (${result.skipped} skipped)`)
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteRecurringTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-maintenance'] })
      toast.success('Recurring task deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return {
    tasks: data ?? [],
    loading: isLoading,
    createTask: createMutation.mutateAsync,
    creating: createMutation.isPending,
    updateTask: updateMutation.mutateAsync,
    updating: updateMutation.isPending,
    toggleActive: toggleMutation.mutateAsync,
    toggling: toggleMutation.isPending,
    generateNow: generateMutation.mutateAsync,
    generating: generateMutation.isPending,
    deleteTask: deleteMutation.mutateAsync,
    deleting: deleteMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['recurring-maintenance'] }),
  }
}

// ── Helpers ────────────────────────────────────────────────

export function getFrequencyColor(frequency: string): string {
  const opt = FREQUENCY_OPTIONS.find(f => f.value === frequency)
  return opt?.color || 'slate'
}

export function getFrequencyLabel(frequency: string): string {
  const opt = FREQUENCY_OPTIONS.find(f => f.value === frequency)
  return opt?.label || frequency
}

export function getPriorityColor(priority: string): string {
  const opt = PRIORITY_OPTIONS.find(p => p.value === priority)
  return opt?.color || 'slate'
}
