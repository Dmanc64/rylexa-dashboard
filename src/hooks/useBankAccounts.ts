'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type BankAccount = {
  id: string
  name: string
  bank_name: string | null
  routing_number: string
  account_number: string
  starting_check_number: number
  next_check_number: number
  gl_cash_account_id: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  fractional_routing: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type BankAccountInput = Omit<
  BankAccount,
  'id' | 'created_at' | 'updated_at' | 'next_check_number'
> & {
  next_check_number?: number
}

export function useBankAccounts(onlyActive = false) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['bank-accounts', onlyActive],
    queryFn: async (): Promise<BankAccount[]> => {
      let q = supabase.from('bank_accounts').select('*').order('name')
      if (onlyActive) q = q.eq('is_active', true)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as BankAccount[]
    },
  })

  const createAccount = useMutation({
    mutationFn: async (input: BankAccountInput): Promise<string> => {
      const { data, error } = await supabase
        .from('bank_accounts')
        .insert({
          ...input,
          // Starting + next align on create; user changes starting_check_number
          // later by updating next_check_number directly if needed.
          next_check_number: input.next_check_number ?? input.starting_check_number,
        })
        .select('id')
        .single()
      if (error) throw error
      return data.id as string
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      toast.success('Bank account created')
    },
    onError: (err: Error) => toast.error('Create failed: ' + err.message),
  })

  const updateAccount = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<BankAccountInput> }) => {
      const { error } = await supabase.from('bank_accounts').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      toast.success('Bank account updated')
    },
    onError: (err: Error) => toast.error('Update failed: ' + err.message),
  })

  const deactivateAccount = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('bank_accounts')
        .update({ is_active: false })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-accounts'] })
      toast.success('Bank account deactivated')
    },
    onError: (err: Error) => toast.error('Deactivation failed: ' + err.message),
  })

  return {
    accounts: query.data ?? [],
    loading: query.isLoading,
    createAccount,
    updateAccount,
    deactivateAccount,
  }
}
