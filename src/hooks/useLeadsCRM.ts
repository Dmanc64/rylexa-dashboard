import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──────────────────────────────────────────────────

export type Lead = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string | null
  source: string
  source_listing_id: string | null
  interested_unit_id: string | null
  interested_property_id: string | null
  stage: string
  assigned_to: string | null
  desired_move_in: string | null
  desired_bedrooms: number | null
  budget_max: number | null
  notes: string | null
  application_id: string | null
  lost_reason: string | null
  created_at: string
  updated_at: string
  // Joined fields
  property_name?: string
  unit_name?: string
  assigned_name?: string
}

export type LeadActivity = {
  id: string
  lead_id: string
  activity_type: string
  description: string
  created_by: string | null
  created_at: string
}

export type Tour = {
  id: string
  lead_id: string
  property_id: string
  unit_id: string | null
  scheduled_at: string
  duration_minutes: number
  status: string
  notes: string | null
  conducted_by: string | null
  completed_at: string | null
  created_at: string
  // Joined fields
  property_name?: string
  unit_name?: string
  conductor_name?: string
}

export type PipelineStage = {
  stage: string
  count: number
  this_month: number
  this_week: number
}

export type LeadFilters = {
  stage?: string
  source?: string
  property_id?: string
  search?: string
}

export type TourFilters = {
  status?: string
  property_id?: string
}

export type CreateLeadPayload = {
  first_name: string
  last_name: string
  email: string
  phone?: string
  source: string
  source_listing_id?: string
  interested_unit_id?: string
  interested_property_id?: string
  assigned_to?: string
  desired_move_in?: string
  desired_bedrooms?: number
  budget_max?: number
  notes?: string
}

export type UpdateLeadPayload = Partial<CreateLeadPayload> & { id: string }

export type ScheduleTourPayload = {
  lead_id: string
  property_id: string
  unit_id?: string
  scheduled_at: string
  duration_minutes?: number
  notes?: string
}

// ── Constants ──────────────────────────────────────────────

export const LEAD_STAGES = ['New', 'Contacted', 'Tour Scheduled', 'Tour Completed', 'Applied', 'Leased', 'Lost']

export const LEAD_SOURCE_OPTIONS = [
  { value: 'website', label: 'Website' },
  { value: 'zillow', label: 'Zillow' },
  { value: 'apartments_com', label: 'Apartments.com' },
  { value: 'realtor_com', label: 'Realtor.com' },
  { value: 'craigslist', label: 'Craigslist' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'referral', label: 'Referral' },
  { value: 'walk_in', label: 'Walk-In' },
  { value: 'phone', label: 'Phone' },
  { value: 'other', label: 'Other' },
]

export const STAGE_COLORS: Record<string, string> = {
  'New': 'bg-blue-100 text-blue-700',
  'Contacted': 'bg-indigo-100 text-indigo-700',
  'Tour Scheduled': 'bg-violet-100 text-violet-700',
  'Tour Completed': 'bg-amber-100 text-amber-700',
  'Applied': 'bg-orange-100 text-orange-700',
  'Leased': 'bg-emerald-100 text-emerald-700',
  'Lost': 'bg-red-100 text-red-600',
}

// ── Fetch helpers ──────────────────────────────────────────

async function fetchLeads(filters: LeadFilters): Promise<Lead[]> {
  let query = supabase
    .from('leads')
    .select(`
      *,
      properties:interested_property_id ( name ),
      units:interested_unit_id ( name ),
      profiles:assigned_to ( full_name )
    `)
    .order('created_at', { ascending: false })

  if (filters.stage) {
    query = query.eq('stage', filters.stage)
  }
  if (filters.source) {
    query = query.eq('source', filters.source)
  }
  if (filters.property_id) {
    query = query.eq('interested_property_id', filters.property_id)
  }
  if (filters.search) {
    // Escape PostgREST special characters to prevent filter injection
    const escaped = filters.search.replace(/[%_,.()"\\]/g, '')
    if (escaped) {
      query = query.or(
        `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,email.ilike.%${escaped}%`
      )
    }
  }

  const { data, error } = await query

  if (error) throw error

  return (data ?? []).map((d: any) => ({
    ...d,
    property_name: d.properties?.name || undefined,
    unit_name: d.units?.name || undefined,
    assigned_name: d.profiles?.full_name || undefined,
  }))
}

async function fetchPipeline(): Promise<PipelineStage[]> {
  const { data, error } = await supabase
    .from('view_lead_pipeline')
    .select('*')

  if (error) throw error
  return (data ?? []) as PipelineStage[]
}

async function fetchLeadActivities(leadId: string): Promise<LeadActivity[]> {
  const { data, error } = await supabase
    .from('lead_activities')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as LeadActivity[]
}

async function fetchTours(filters: TourFilters): Promise<Tour[]> {
  let query = supabase
    .from('tours')
    .select(`
      *,
      properties:property_id ( name ),
      units:unit_id ( name ),
      profiles:conducted_by ( full_name )
    `)
    .order('scheduled_at', { ascending: true })

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
    property_name: d.properties?.name || undefined,
    unit_name: d.units?.name || undefined,
    conductor_name: d.profiles?.full_name || undefined,
  }))
}

// ── Hooks ──────────────────────────────────────────────────

export function useLeads(filters: LeadFilters = {}) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['leads', filters],
    queryFn: () => fetchLeads(filters),
  })

  // ── Create ──
  const createMutation = useMutation({
    mutationFn: async (payload: CreateLeadPayload) => {
      const { data: created, error } = await supabase
        .from('leads')
        .insert({
          first_name: payload.first_name,
          last_name: payload.last_name,
          email: payload.email,
          phone: payload.phone || null,
          source: payload.source,
          source_listing_id: payload.source_listing_id || null,
          interested_unit_id: payload.interested_unit_id || null,
          interested_property_id: payload.interested_property_id || null,
          assigned_to: payload.assigned_to || null,
          desired_move_in: payload.desired_move_in || null,
          desired_bedrooms: payload.desired_bedrooms ?? null,
          budget_max: payload.budget_max ?? null,
          notes: payload.notes || null,
          stage: 'New',
        })
        .select()
        .single()

      if (error) throw error
      return created
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline'] })
      toast.success('Lead created')
    },
    onError: (err: any) => {
      toast.error(`Failed to create lead: ${err.message}`)
    },
  })

  // ── Update ──
  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: UpdateLeadPayload) => {
      const { data: updated, error } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return updated
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline'] })
      toast.success('Lead updated')
    },
    onError: (err: any) => {
      toast.error(`Failed to update lead: ${err.message}`)
    },
  })

  // ── Mark Lost ──
  const markLostMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase
        .from('leads')
        .update({ stage: 'Lost', lost_reason: reason })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline'] })
      toast.success('Lead marked as lost')
    },
    onError: (err: any) => {
      toast.error(`Failed to mark lead as lost: ${err.message}`)
    },
  })

  // ── Advance Stage (RPC) ──
  const advanceStageMutation = useMutation({
    mutationFn: async (leadId: string) => {
      // Determine the next stage from the current lead data
      const currentLeads = queryClient.getQueryData<Lead[]>(['leads', filters]) ?? data ?? []
      const currentLead = currentLeads.find((l: Lead) => l.id === leadId)

      if (!currentLead) {
        throw new Error('Lead not found in current data. Please refresh and try again.')
      }

      const activeStages = LEAD_STAGES.filter(s => s !== 'Lost')
      const currentIndex = activeStages.indexOf(currentLead.stage)

      if (currentIndex === -1 || currentIndex >= activeStages.length - 1) {
        throw new Error('Lead is already at the final stage')
      }

      const nextStage = activeStages[currentIndex + 1]

      const { data: result, error } = await supabase.rpc('advance_lead_stage', {
        p_lead_id: leadId,
        p_new_stage: nextStage,
      })
      if (error) throw error
      return result
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activities'] })
      toast.success('Lead advanced to next stage')
    },
    onError: (err: any) => {
      toast.error(`Failed to advance stage: ${err.message}`)
    },
  })

  return {
    leads: data ?? [],
    loading: isLoading,
    createLead: createMutation.mutateAsync,
    creating: createMutation.isPending,
    updateLead: updateMutation.mutateAsync,
    updating: updateMutation.isPending,
    markLeadLost: markLostMutation.mutateAsync,
    markingLost: markLostMutation.isPending,
    advanceStage: advanceStageMutation.mutateAsync,
    advancingStage: advanceStageMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['leads'] }),
  }
}

export function useLeadPipeline() {
  const { data, isLoading } = useQuery({
    queryKey: ['lead-pipeline'],
    queryFn: fetchPipeline,
  })

  return {
    pipeline: data ?? [],
    loading: isLoading,
  }
}

export function useLeadActivities(leadId: string | null) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['lead-activities', leadId],
    queryFn: () => fetchLeadActivities(leadId!),
    enabled: !!leadId,
  })

  const addActivityMutation = useMutation({
    mutationFn: async ({ leadId, type, description }: { leadId: string; type: string; description: string }) => {
      const { data: user } = await supabase.auth.getUser()

      const { data: created, error } = await supabase
        .from('lead_activities')
        .insert({
          lead_id: leadId,
          activity_type: type,
          description,
          created_by: user?.user?.id ?? null,
        })
        .select()
        .single()

      if (error) throw error
      return created
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lead-activities'] })
      toast.success('Activity added')
    },
    onError: (err: any) => {
      toast.error(`Failed to add activity: ${err.message}`)
    },
  })

  return {
    activities: data ?? [],
    loading: isLoading,
    addActivity: addActivityMutation.mutateAsync,
    addingActivity: addActivityMutation.isPending,
  }
}

export function useTours(filters: TourFilters = {}) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['tours', filters],
    queryFn: () => fetchTours(filters),
  })

  // ── Schedule Tour ──
  const scheduleMutation = useMutation({
    mutationFn: async (payload: ScheduleTourPayload) => {
      const { data: user } = await supabase.auth.getUser()

      const { data: created, error } = await supabase
        .from('tours')
        .insert({
          lead_id: payload.lead_id,
          property_id: payload.property_id,
          unit_id: payload.unit_id || null,
          scheduled_at: payload.scheduled_at,
          duration_minutes: payload.duration_minutes || 30,
          status: 'Scheduled',
          notes: payload.notes || null,
          conducted_by: user?.user?.id ?? null,
        })
        .select()
        .single()

      if (error) throw error

      // Auto-advance lead to 'Tour Scheduled' if still in an earlier stage
      const earlyStages = ['New', 'Contacted']
      const { data: lead } = await supabase
        .from('leads')
        .select('stage')
        .eq('id', payload.lead_id)
        .single()

      if (lead && earlyStages.includes(lead.stage)) {
        await supabase
          .from('leads')
          .update({ stage: 'Tour Scheduled' })
          .eq('id', payload.lead_id)
      }

      return created
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tours'] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activities'] })
      toast.success('Tour scheduled')
    },
    onError: (err: any) => {
      toast.error(`Failed to schedule tour: ${err.message}`)
    },
  })

  // ── Complete Tour ──
  const completeMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes?: string }) => {
      const updates: Record<string, any> = {
        status: 'Completed',
        completed_at: new Date().toISOString(),
      }
      if (notes !== undefined) updates.notes = notes

      const { error } = await supabase
        .from('tours')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tours'] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activities'] })
      toast.success('Tour marked as completed')
    },
    onError: (err: any) => {
      toast.error(`Failed to complete tour: ${err.message}`)
    },
  })

  // ── Cancel Tour ──
  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tours')
        .update({ status: 'Cancelled' })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tours'] })
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['lead-pipeline'] })
      queryClient.invalidateQueries({ queryKey: ['lead-activities'] })
      toast.success('Tour cancelled')
    },
    onError: (err: any) => {
      toast.error(`Failed to cancel tour: ${err.message}`)
    },
  })

  return {
    tours: data ?? [],
    loading: isLoading,
    scheduleTour: scheduleMutation.mutateAsync,
    scheduling: scheduleMutation.isPending,
    completeTour: completeMutation.mutateAsync,
    completing: completeMutation.isPending,
    cancelTour: cancelMutation.mutateAsync,
    cancelling: cancelMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['tours'] }),
  }
}
