'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'

export type LedgerEntry = {
  id: string
  created_at: string
  type: 'Rent Charge' | 'Utility Charge' | 'Payment' | 'Late Fee' | 'Credit' | string
  category: string | null
  description: string
  amount: number
  status: string
  payment_method: string | null
  running_balance: number
}

type RecordPaymentParams = {
  leaseId: string
  amount: number
  date: string
  category: string
  description?: string
  paymentMethod?: string
}

type PostChargeParams = {
  leaseId: string
  type: 'Utility Charge' | 'Late Fee' | 'Credit'
  amount: number
  date: string
  description?: string
}

async function fetchLedger(leaseId: string): Promise<LedgerEntry[]> {
  const { data, error } = await supabase.rpc('get_tenant_ledger', { p_lease_id: leaseId })
  if (error) throw error
  return (data as LedgerEntry[]) || []
}

async function fetchBalance(leaseId: string): Promise<number> {
  const { data, error } = await supabase.rpc('get_tenant_balance', { p_lease_id: leaseId })
  if (error) throw error
  return Number(data) || 0
}

export function useTenantLedger(leaseId: string | undefined) {
  const queryClient = useQueryClient()

  const { data: entries, isLoading: ledgerLoading } = useQuery({
    queryKey: ['tenant-ledger', leaseId],
    queryFn: () => fetchLedger(leaseId!),
    enabled: !!leaseId,
  })

  const { data: balance, isLoading: balanceLoading } = useQuery({
    queryKey: ['tenant-balance', leaseId],
    queryFn: () => fetchBalance(leaseId!),
    enabled: !!leaseId,
  })

  const paymentMutation = useMutation({
    mutationFn: async (params: RecordPaymentParams) => {
      const { data, error } = await supabase.rpc('record_tenant_payment', {
        p_lease_id: params.leaseId,
        p_amount: params.amount,
        p_date: params.date,
        p_category: params.category,
        p_description: params.description || null,
        p_payment_method: params.paymentMethod || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success('Payment recorded successfully')
      queryClient.invalidateQueries({ queryKey: ['tenant-ledger', leaseId] })
      queryClient.invalidateQueries({ queryKey: ['tenant-balance', leaseId] })
    },
    onError: (error: any) => {
      toast.error('Failed to record payment: ' + error.message)
    },
  })

  const chargeMutation = useMutation({
    mutationFn: async (params: PostChargeParams) => {
      const { data, error } = await supabase.rpc('post_manual_charge', {
        p_lease_id: params.leaseId,
        p_type: params.type,
        p_amount: params.amount,
        p_date: params.date,
        p_description: params.description || null,
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success('Charge posted successfully')
      queryClient.invalidateQueries({ queryKey: ['tenant-ledger', leaseId] })
      queryClient.invalidateQueries({ queryKey: ['tenant-balance', leaseId] })
    },
    onError: (error: any) => {
      toast.error('Failed to post charge: ' + error.message)
    },
  })

  const recordPayment = async (params: RecordPaymentParams) => {
    try {
      await paymentMutation.mutateAsync(params)
      return true
    } catch {
      return false
    }
  }

  const postCharge = async (params: PostChargeParams) => {
    try {
      await chargeMutation.mutateAsync(params)
      return true
    } catch {
      return false
    }
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['tenant-ledger', leaseId] })
    queryClient.invalidateQueries({ queryKey: ['tenant-balance', leaseId] })
  }

  return {
    entries: entries ?? [],
    balance: balance ?? 0,
    loading: ledgerLoading || balanceLoading,
    recordPayment,
    recording: paymentMutation.isPending,
    postCharge,
    posting: chargeMutation.isPending,
    refresh,
  }
}
