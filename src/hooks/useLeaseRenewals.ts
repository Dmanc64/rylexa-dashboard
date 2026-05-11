import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'

export type LeaseRenewal = {
  id: string
  lease_id: string
  proposed_rent: number
  proposed_end_date: string
  notes: string | null
  status: 'Pending' | 'Accepted' | 'Declined' | 'Withdrawn'
  created_at: string
  offer_pdf_path: string | null
  executed_pdf_path: string | null
  new_lease_id: string | null
  // Joined fields
  tenant_name?: string
  property_name?: string
  unit_name?: string
  current_rent?: number
  current_end_date?: string
}

async function fetchRenewals(): Promise<LeaseRenewal[]> {
  const { data, error } = await supabase
    .from('lease_renewals')
    .select(`
      id, lease_id, proposed_rent, proposed_end_date, notes, status,
      created_at, offer_pdf_path, executed_pdf_path, new_lease_id,
      leases (
        rent_amount, end_date,
        tenants ( first_name, last_name ),
        units ( name, properties ( name ) )
      )
    `)
    .order('created_at', { ascending: false })

  if (error) throw error

  return (data ?? []).map((r: any) => ({
    id: r.id,
    lease_id: r.lease_id,
    proposed_rent: Number(r.proposed_rent),
    proposed_end_date: r.proposed_end_date,
    notes: r.notes,
    status: r.status,
    created_at: r.created_at,
    offer_pdf_path: r.offer_pdf_path,
    executed_pdf_path: r.executed_pdf_path,
    new_lease_id: r.new_lease_id,
    tenant_name: r.leases?.tenants
      ? `${r.leases.tenants.first_name} ${r.leases.tenants.last_name}`
      : 'Unknown',
    property_name: r.leases?.units?.properties?.name ?? 'Unknown',
    unit_name: r.leases?.units?.name ?? 'Unknown',
    current_rent: r.leases?.rent_amount != null ? Number(r.leases.rent_amount) : undefined,
    current_end_date: r.leases?.end_date,
  }))
}

export function useLeaseRenewals() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['lease-renewals'],
    queryFn: fetchRenewals,
  })

  // Create a new renewal offer
  const createOfferMutation = useMutation({
    mutationFn: async (params: {
      lease_id: string
      proposed_rent: number
      proposed_end_date: string
      notes?: string
    }) => {
      const { data, error } = await supabase.rpc('create_renewal_offer', {
        p_lease_id: params.lease_id,
        p_proposed_rent: params.proposed_rent,
        p_proposed_end_date: params.proposed_end_date,
        p_notes: params.notes || null,
      })
      if (error) throw error
      return data as string // renewal UUID
    },
    onSuccess: () => {
      toast.success('Renewal offer created and tenant notified.')
      queryClient.invalidateQueries({ queryKey: ['lease-renewals'] })
    },
    onError: (error: any) => {
      toast.error('Failed to create offer: ' + error.message)
    },
  })

  // Withdraw a pending offer (management only)
  const withdrawOfferMutation = useMutation({
    mutationFn: async (params: { renewal_id: string; reason?: string }) => {
      const { error } = await supabase.rpc('withdraw_renewal_offer', {
        p_renewal_id: params.renewal_id,
        p_reason: params.reason || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Renewal offer withdrawn.')
      queryClient.invalidateQueries({ queryKey: ['lease-renewals'] })
    },
    onError: (error: any) => {
      toast.error('Failed to withdraw: ' + error.message)
    },
  })

  // Accept a renewal offer (tenant)
  const acceptOfferMutation = useMutation({
    mutationFn: async (params: { renewal_id: string; user_agent?: string }) => {
      const { data, error } = await supabase.rpc('accept_renewal_offer', {
        p_renewal_id: params.renewal_id,
        p_ip_address: null, // IP captured server-side if needed
        p_user_agent: params.user_agent || null,
      })
      if (error) throw error
      return data as string // new lease UUID
    },
    onSuccess: () => {
      toast.success('Lease renewal accepted! Your new lease is now active.')
      queryClient.invalidateQueries({ queryKey: ['lease-renewals'] })
      queryClient.invalidateQueries({ queryKey: ['leases'] })
    },
    onError: (error: any) => {
      toast.error('Failed to accept: ' + error.message)
    },
  })

  // Decline a renewal offer
  const declineOfferMutation = useMutation({
    mutationFn: async (params: { renewal_id: string; reason?: string }) => {
      const { error } = await supabase.rpc('decline_renewal_offer', {
        p_renewal_id: params.renewal_id,
        p_reason: params.reason || null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Renewal offer declined.')
      queryClient.invalidateQueries({ queryKey: ['lease-renewals'] })
    },
    onError: (error: any) => {
      toast.error('Failed to decline: ' + error.message)
    },
  })

  // Generate renewal PDF
  const generatePdfMutation = useMutation({
    mutationFn: async (params: { renewal_id: string; mode?: 'offer' | 'executed' }) => {
      const { data, error } = await supabase.functions.invoke('generate-renewal-offer', {
        body: {
          renewal_id: params.renewal_id,
          mode: params.mode || 'offer',
        },
      })

      if (error) {
        let msg = error.message || 'PDF generation failed'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        throw new Error(msg)
      }

      return data instanceof Blob ? data : new Blob([JSON.stringify(data)], { type: 'application/pdf' })
    },
    onError: (error: any) => {
      toast.error('PDF generation failed: ' + error.message)
    },
  })

  // Helper: get pending renewal for a specific lease
  function pendingForLease(leaseId: string): LeaseRenewal | undefined {
    return (data ?? []).find(
      (r) => r.lease_id === leaseId && r.status === 'Pending'
    )
  }

  // Helper: get renewal status for a specific lease (most recent)
  function renewalForLease(leaseId: string): LeaseRenewal | undefined {
    return (data ?? []).find((r) => r.lease_id === leaseId)
  }

  return {
    renewals: data ?? [],
    loading: isLoading,
    pendingForLease,
    renewalForLease,
    createOffer: createOfferMutation.mutateAsync,
    creatingOffer: createOfferMutation.isPending,
    withdrawOffer: withdrawOfferMutation.mutateAsync,
    withdrawing: withdrawOfferMutation.isPending,
    acceptOffer: acceptOfferMutation.mutateAsync,
    accepting: acceptOfferMutation.isPending,
    declineOffer: declineOfferMutation.mutateAsync,
    declining: declineOfferMutation.isPending,
    generatePdf: generatePdfMutation.mutateAsync,
    generatingPdf: generatePdfMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['lease-renewals'] }),
  }
}
