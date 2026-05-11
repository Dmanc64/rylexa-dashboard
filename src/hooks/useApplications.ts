import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { processApplication as processApplicationAction, type LeaseDetails } from '@/actions/application-actions'
import { preapproveApplication as preapproveApplicationAction } from '@/actions/preapprove-application'

export type Application = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  status: 'Pending' | 'Preapproved' | 'Approved' | 'Denied' | 'Withdrawn'
  unit_name: string
  property_name: string
  income: number
  employer: string
  credit_score?: number
  created_at: string
  // Screening fields
  date_of_birth?: string
  months_at_address?: number
  previous_landlord_name?: string
  previous_landlord_phone?: string
  months_at_employer?: number
  additional_income?: number
  num_occupants?: number
  background_clear?: boolean
  eviction_history?: boolean
  bankruptcy_history?: boolean
  screening_score?: number
  screening_status?: 'Unscreened' | 'Screened' | 'Waived'
  screening_notes?: string
  screened_at?: string
}

const PAGE_SIZE = 25

async function fetchApplications(page: number): Promise<{ applications: Application[]; totalCount: number }> {
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  // Join property name through units (unit_id → units.property_id → properties.name)
  // instead of a direct applications.property_id FK (column was dropped in migration 030)
  const { data, error, count } = await supabase
    .from('applications')
    .select(`*, units (name, properties (name))`, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw error

  const applications = (data ?? []).map((a: any) => ({
    ...a,
    unit_name: a.units?.name || 'Unknown Unit',
    property_name: a.units?.properties?.name || 'Unknown Property',
  }))

  return { applications, totalCount: count ?? 0 }
}

export function useApplications(page = 0) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['applications', page],
    queryFn: () => fetchApplications(page),
  })

  const processMutation = useMutation({
    mutationFn: async ({ id, action, leaseDetails }: { id: string; action: 'Approved' | 'Denied'; leaseDetails?: LeaseDetails }) => {
      const result = await processApplicationAction(id, action, leaseDetails)

      if (!result.success) {
        throw new Error(result.message)
      }

      return { id, action, message: result.message }
    },
    onSuccess: ({ id, action, message }) => {
      queryClient.setQueryData(['applications', page], (old: { applications: Application[]; totalCount: number } | undefined) => {
        if (!old) return old
        return {
          ...old,
          applications: old.applications.map((a) => (a.id === id ? { ...a, status: action } : a)),
        }
      })
      // Refetch to sync with server (approval may create leases, update tenants, etc.)
      queryClient.invalidateQueries({ queryKey: ['applications'] })
      toast.success(message)
    },
    onError: (error: any) => {
      toast.error(`Error processing application: ${error.message}`)
    },
  })

  const processApplication = async (id: string, action: 'Approved' | 'Denied', leaseDetails?: LeaseDetails) => {
    try {
      await processMutation.mutateAsync({ id, action, leaseDetails })
    } catch {
      // Error already handled by onError callback above
    }
  }

  // Preapprove — flips the application to 'Preapproved' and creates a Lead
  // in the Leasing CRM. Returns the new lead id so the caller can offer a
  // "view in CRM" toast link.
  const preapproveMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = await preapproveApplicationAction(id)
      if (!result.success) throw new Error(result.message)
      return { id, message: result.message, leadId: result.leadId }
    },
    onSuccess: ({ id, message }) => {
      queryClient.setQueryData(['applications', page], (old: { applications: Application[]; totalCount: number } | undefined) => {
        if (!old) return old
        return {
          ...old,
          applications: old.applications.map((a) => (a.id === id ? { ...a, status: 'Preapproved' as const } : a)),
        }
      })
      queryClient.invalidateQueries({ queryKey: ['applications'] })
      // Note: toast intentionally fired by the caller so it can include a
      // "View in CRM" link pointing at the new lead id.
      void message
    },
    onError: (error: Error) => {
      toast.error(`Error preapproving application: ${error.message}`)
    },
  })

  const preapproveApplication = async (id: string): Promise<{ leadId?: string; message: string } | null> => {
    try {
      const result = await preapproveMutation.mutateAsync(id)
      return { leadId: result.leadId, message: result.message }
    } catch {
      return null
    }
  }

  return {
    applications: data?.applications ?? [],
    totalCount: data?.totalCount ?? 0,
    page,
    pageSize: PAGE_SIZE,
    loading: isLoading,
    processing: processMutation.isPending || preapproveMutation.isPending,
    processApplication,
    preapproveApplication,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['applications'] }),
  }
}
