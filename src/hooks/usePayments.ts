import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'

// ── Types ──

export type Payment = {
  id: string
  lease_id: string
  tenant_id: string
  amount: number
  stripe_payment_intent_id: string | null
  stripe_payment_method_id: string | null
  card_brand: string | null
  card_last4: string | null
  status: string
  is_autopay: boolean
  failure_reason: string | null
  created_at: string
}

export type SavedCard = {
  id: string
  tenant_id: string
  user_id: string
  stripe_customer_id: string
  stripe_payment_method_id: string
  card_brand: string | null
  card_last4: string | null
  exp_month: number | null
  exp_year: number | null
  is_default: boolean
  created_at: string
}

export type AutopaySettings = {
  id: string
  lease_id: string
  payment_method_id: string
  amount_type: string
  fixed_amount: number | null
  max_amount: number | null
  day_of_month: number
  is_active: boolean
  next_run_date: string | null
  created_at: string
  updated_at: string
}

// ── Fetch helpers ──

async function fetchPaymentHistory(leaseId: string): Promise<Payment[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('lease_id', leaseId)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as Payment[]
}

async function fetchSavedCards(): Promise<SavedCard[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('tenant_payment_methods')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as SavedCard[]
}

async function fetchAutopaySettings(leaseId: string): Promise<AutopaySettings | null> {
  const { data, error } = await supabase
    .from('autopay_settings')
    .select('*')
    .eq('lease_id', leaseId)
    .maybeSingle()

  if (error) throw error
  return (data as AutopaySettings) ?? null
}

// ── Payment History Hook ──

export function usePaymentHistory(leaseId?: string) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['payment-history', leaseId],
    queryFn: async (): Promise<Payment[]> => {
      if (!leaseId) return []
      return fetchPaymentHistory(leaseId)
    },
    enabled: !!leaseId,
    staleTime: 30_000, // 30s
  })

  return {
    data: data ?? [],
    loading: isLoading,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['payment-history', leaseId] }),
  }
}

// ── Saved Cards Hook ──

export function useSavedCards() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['saved-cards'],
    queryFn: fetchSavedCards,
    staleTime: 60_000, // 1 min
  })

  const removeCardMutation = useMutation({
    mutationFn: async (cardId: string) => {
      const { error } = await supabase
        .from('tenant_payment_methods')
        .delete()
        .eq('id', cardId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Card removed')
      queryClient.invalidateQueries({ queryKey: ['saved-cards'] })
    },
    onError: (err: Error) => toast.error('Failed to remove card: ' + err.message),
  })

  const setDefaultCardMutation = useMutation({
    mutationFn: async (cardId: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Clear is_default on all cards for this user
      const { error: clearError } = await supabase
        .from('tenant_payment_methods')
        .update({ is_default: false })
        .eq('user_id', user.id)
      if (clearError) throw clearError

      // Set the chosen card as default
      const { error: setError } = await supabase
        .from('tenant_payment_methods')
        .update({ is_default: true })
        .eq('id', cardId)
      if (setError) throw setError
    },
    onSuccess: () => {
      toast.success('Default card updated')
      queryClient.invalidateQueries({ queryKey: ['saved-cards'] })
    },
    onError: (err: Error) => toast.error('Failed to set default card: ' + err.message),
  })

  const saveCardMutation = useMutation({
    mutationFn: async (paymentMethodId: string) => {
      const { data: result, error } = await supabase.functions.invoke('save-payment-method', {
        body: { paymentMethodId },
      })

      if (error) {
        let msg = error.message || 'Failed to save card'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || errBody?.message || msg
        }
        throw new Error(msg)
      }

      return result
    },
    onSuccess: () => {
      toast.success('Card saved successfully')
      queryClient.invalidateQueries({ queryKey: ['saved-cards'] })
    },
    onError: (err: Error) => toast.error('Failed to save card: ' + err.message),
  })

  return {
    data: data ?? [],
    loading: isLoading,
    removeCard: removeCardMutation.mutateAsync,
    removingCard: removeCardMutation.isPending,
    setDefaultCard: setDefaultCardMutation.mutateAsync,
    settingDefault: setDefaultCardMutation.isPending,
    saveCard: saveCardMutation.mutateAsync,
    savingCard: saveCardMutation.isPending,
  }
}

// ── Autopay Settings Hook ──

export function useAutopaySettings(leaseId: string) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['autopay-settings', leaseId],
    queryFn: () => fetchAutopaySettings(leaseId),
    enabled: !!leaseId,
    staleTime: 60_000, // 1 min
  })

  const configureAutopayMutation = useMutation({
    mutationFn: async (settings: {
      payment_method_id: string
      amount_type: string
      fixed_amount?: number | null
      max_amount?: number | null
      day_of_month: number
    }) => {
      const { error } = await supabase
        .from('autopay_settings')
        .upsert(
          {
            lease_id: leaseId,
            payment_method_id: settings.payment_method_id,
            amount_type: settings.amount_type,
            fixed_amount: settings.fixed_amount ?? null,
            max_amount: settings.max_amount ?? null,
            day_of_month: settings.day_of_month,
            is_active: true,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'lease_id' }
        )
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Autopay configured')
      queryClient.invalidateQueries({ queryKey: ['autopay-settings', leaseId] })
    },
    onError: (err: Error) => toast.error('Failed to configure autopay: ' + err.message),
  })

  const disableAutopayMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('autopay_settings')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('lease_id', leaseId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Autopay disabled')
      queryClient.invalidateQueries({ queryKey: ['autopay-settings', leaseId] })
    },
    onError: (err: Error) => toast.error('Failed to disable autopay: ' + err.message),
  })

  return {
    data: data ?? null,
    loading: isLoading,
    configureAutopay: configureAutopayMutation.mutateAsync,
    configuringAutopay: configureAutopayMutation.isPending,
    disableAutopay: () => disableAutopayMutation.mutateAsync(),
    disablingAutopay: disableAutopayMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['autopay-settings', leaseId] }),
  }
}
