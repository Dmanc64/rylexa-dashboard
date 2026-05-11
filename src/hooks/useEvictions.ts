import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type EvictionStatus =
  | 'Notice Served'
  | 'Filed'
  | 'Hearing Scheduled'
  | 'Judgment'
  | 'Completed'
  | 'Dismissed'

export type NoticeType =
  | '3-Day Pay or Quit'
  | '30-Day Notice'
  | '60-Day Notice'
  | 'Lease Violation'
  | 'Other'

export type EvictionCase = {
  id: string
  lease_id: string | null
  tenant_id: string | null
  property_id: string | null
  unit_id: string | null
  status: EvictionStatus
  reason: string | null
  notice_type: NoticeType | null
  notice_served_date: string | null
  filed_date: string | null
  court_case_number: string | null
  court_date: string | null
  hearing_date: string | null
  outcome: string | null
  judgment_amount: number | null
  notes: string | null
  attorney_name: string | null
  attorney_phone: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined fields
  tenant_first_name: string
  tenant_last_name: string
  property_name: string
  unit_name: string
}

export type CreateEvictionInput = {
  lease_id?: string
  tenant_id?: string
  property_id?: string
  unit_id?: string
  status: EvictionStatus
  reason?: string
  notice_type?: NoticeType
  notice_served_date?: string
  filed_date?: string
  court_case_number?: string
  court_date?: string
  hearing_date?: string
  outcome?: string
  judgment_amount?: number
  notes?: string
  attorney_name?: string
  attorney_phone?: string
}

export type UpdateEvictionInput = Partial<CreateEvictionInput> & { id: string }

async function fetchEvictions(statusFilter?: EvictionStatus | 'Active'): Promise<EvictionCase[]> {
  let query = supabase
    .from('eviction_cases')
    .select(`
      *,
      tenants (first_name, last_name),
      properties (name),
      units (name)
    `)
    .order('created_at', { ascending: false })

  if (statusFilter === 'Active') {
    // Active = everything except Completed and Dismissed
    query = query.not('status', 'in', '("Completed","Dismissed")')
  } else if (statusFilter) {
    query = query.eq('status', statusFilter)
  }

  const { data, error } = await query

  if (error) throw error

  return (data ?? []).map((row: any) => ({
    ...row,
    tenant_first_name: row.tenants?.first_name || 'Unknown',
    tenant_last_name: row.tenants?.last_name || '',
    property_name: row.properties?.name || 'Unknown Property',
    unit_name: row.units?.name || 'N/A',
  }))
}

export function useEvictions(statusFilter?: EvictionStatus | 'Active') {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['evictions', statusFilter],
    queryFn: () => fetchEvictions(statusFilter),
  })

  // ── Create ──
  const createMutation = useMutation({
    mutationFn: async (input: CreateEvictionInput) => {
      const { data: user } = await supabase.auth.getUser()
      const { data: created, error } = await supabase
        .from('eviction_cases')
        .insert({ ...input, created_by: user?.user?.id ?? null })
        .select()
        .single()
      if (error) throw error
      return created
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evictions'] })
      toast.success('Eviction case created')
    },
    onError: (err: any) => {
      toast.error(`Failed to create eviction case: ${err.message}`)
    },
  })

  // ── Update ──
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: UpdateEvictionInput) => {
      const { data: updated, error } = await supabase
        .from('eviction_cases')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return updated
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evictions'] })
      toast.success('Eviction case updated')
    },
    onError: (err: any) => {
      toast.error(`Failed to update eviction case: ${err.message}`)
    },
  })

  // ── Update Status (convenience) ──
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: EvictionStatus }) => {
      const { data: updated, error } = await supabase
        .from('eviction_cases')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return updated
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['evictions'] })
      toast.success(`Status updated to ${status}`)
    },
    onError: (err: any) => {
      toast.error(`Failed to update status: ${err.message}`)
    },
  })

  return {
    evictions: data ?? [],
    loading: isLoading,
    error,
    createEviction: createMutation.mutateAsync,
    creating: createMutation.isPending,
    updateEviction: updateMutation.mutateAsync,
    updating: updateMutation.isPending,
    updateStatus: statusMutation.mutateAsync,
    updatingStatus: statusMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['evictions'] }),
  }
}
