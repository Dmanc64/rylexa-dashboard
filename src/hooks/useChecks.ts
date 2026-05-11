'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type CheckRun = {
  id: string
  check_number: number
  bank_account_id: string
  vendor_id: string
  check_date: string
  total_amount: number
  memo: string | null
  pdf_url: string | null
  pdf_path: string | null
  status: 'Printed' | 'Voided'
  printed_by: string | null
  printed_at: string
  voided_by: string | null
  voided_at: string | null
  voided_reason: string | null
  // Joined
  bank_account_name?: string
  vendor_name?: string
}

export type GenerateCheckResult = {
  success: boolean
  check_run_id: string
  check_number: number
  reference: string
  total_amount: number
  pdf_url: string
  pdf_path: string
  micr_embedded: boolean
  number_mismatch: boolean
}

export function useChecks(bankAccountId?: string) {
  const queryClient = useQueryClient()

  const list = useQuery({
    queryKey: ['check-runs', bankAccountId],
    queryFn: async (): Promise<CheckRun[]> => {
      let q = supabase
        .from('check_runs')
        .select(`
          *,
          bank_accounts:bank_account_id ( name ),
          vendors:vendor_id ( company_name, contact_name )
        `)
        .order('check_number', { ascending: false })
      if (bankAccountId) q = q.eq('bank_account_id', bankAccountId)
      const { data, error } = await q
      if (error) throw error
      type Row = Omit<CheckRun, 'bank_account_name' | 'vendor_name'> & {
        bank_accounts?: { name?: string } | null
        vendors?: { company_name?: string | null; contact_name?: string | null } | null
      }
      return ((data ?? []) as Row[]).map((row) => ({
        ...row,
        bank_account_name: row.bank_accounts?.name,
        vendor_name:
          row.vendors?.company_name ?? row.vendors?.contact_name ?? undefined,
      })) as CheckRun[]
    },
  })

  const generateCheck = useMutation({
    mutationFn: async (args: {
      bill_ids: string[]
      bank_account_id: string
      memo?: string
      check_date?: string
    }): Promise<GenerateCheckResult> => {
      const { data, error } = await supabase.functions.invoke('generate-check', {
        body: args,
      })
      if (error) throw new Error(error.message)
      const payload = data as GenerateCheckResult & { error?: string }
      if (payload?.error) throw new Error(payload.error)
      if (!payload?.success) throw new Error('Check generation returned no success flag')
      return payload
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['check-runs'] })
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['ap-aging'] })
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      if (res.number_mismatch) {
        toast.warning(`Check saved as #${res.check_number} (PDF shows the reserved number).`)
      } else {
        toast.success(`Check #${res.check_number} printed`)
      }
    },
    onError: (err: Error) => toast.error('Check generation failed: ' + err.message),
  })

  const voidCheck = useMutation({
    mutationFn: async ({
      checkRunId,
      reason,
    }: {
      checkRunId: string
      reason?: string
    }) => {
      const { error } = await supabase.rpc('void_check_run', {
        p_check_run_id: checkRunId,
        p_reason: reason ?? null,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['check-runs'] })
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['ap-aging'] })
      toast.success('Check voided')
    },
    onError: (err: Error) => toast.error('Void failed: ' + err.message),
  })

  return {
    checkRuns: list.data ?? [],
    loading: list.isLoading,
    generateCheck,
    voidCheck,
  }
}
