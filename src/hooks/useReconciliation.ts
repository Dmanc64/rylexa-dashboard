import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type Transaction = {
  id: string
  date: string
  description: string
  amount: number
  type: 'Credit' | 'Debit'
  status: 'Pending' | 'Reconciled' | 'Flagged'
  lease_id: string | null
  vendor_id: string | null
  vendor_name: string | null
  lease_label: string | null
  ai_confidence: number
  suggested_match: string | null
  // AI categorization fields (Phase 8)
  ai_category: string | null
  ai_match_lease_id: string | null
  ai_match_vendor_id: string | null
}

type ReconciliationData = {
  transactions: Transaction[]
  stats: { total: number; reconciled: number; pending: number; flagged: number; matchRate: number }
}

async function fetchTransactions(): Promise<ReconciliationData> {
  // Parallel fetch: transactions + full-table stats from RPC
  const [txnRes, statsRes] = await Promise.all([
    supabase
      .from('transactions')
      .select(`
        id, created_at, description, amount, type, status,
        lease_id, vendor_id,
        ai_category, ai_confidence, ai_match_lease_id, ai_match_vendor_id,
        vendors!vendor_id ( company_name ),
        leases!lease_id ( units ( name, properties ( name ) ) )
      `)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.rpc('get_reconciliation_stats'),
  ])

  if (txnRes.error) throw txnRes.error
  if (statsRes.error) throw statsRes.error

  const transactions: Transaction[] = (txnRes.data ?? []).map((t: any) => {
    const unitName = t.leases?.units?.name
    const propName = t.leases?.units?.properties?.name
    const leaseLabel = unitName && propName ? `${propName} - Unit ${unitName}` : null

    // Use real AI confidence if available, otherwise fall back to heuristic
    const fallbackConfidence = leaseLabel ? 92 : t.vendors?.company_name ? 78 : 45
    const confidence = t.ai_confidence ?? fallbackConfidence

    return {
      id: t.id,
      date: t.created_at,
      description: t.description || 'Transaction',
      amount: Math.abs(t.amount ?? 0),
      type: t.type === 'Credit' || t.type === 'Debit' ? t.type : (t.amount ?? 0) >= 0 ? 'Credit' : 'Debit',
      status: t.status || 'Pending',
      lease_id: t.lease_id,
      vendor_id: t.vendor_id,
      vendor_name: t.vendors?.company_name || null,
      lease_label: leaseLabel,
      ai_confidence: confidence,
      suggested_match: t.ai_category || leaseLabel || t.vendors?.company_name || 'No Match Found',
      ai_category: t.ai_category || null,
      ai_match_lease_id: t.ai_match_lease_id || null,
      ai_match_vendor_id: t.ai_match_vendor_id || null,
    }
  })

  // Use full-table stats from RPC instead of computing from limited 50-row subset
  const rpcStats = statsRes.data as any
  const stats = rpcStats
    ? {
        total: Number(rpcStats.total ?? 0),
        reconciled: Number(rpcStats.reconciled ?? 0),
        pending: Number(rpcStats.pending ?? 0),
        flagged: Number(rpcStats.flagged ?? 0),
        matchRate: Number(rpcStats.match_rate ?? 0),
      }
    : {
        total: transactions.length,
        reconciled: transactions.filter((t) => t.status === 'Reconciled').length,
        pending: transactions.filter((t) => t.status === 'Pending').length,
        flagged: transactions.filter((t) => t.status === 'Flagged').length,
        matchRate: transactions.length > 0 ? (transactions.filter((t) => t.status === 'Reconciled').length / transactions.length) * 100 : 0,
      }

  return { transactions, stats }
}

export function useReconciliation() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['reconciliation'],
    queryFn: fetchTransactions,
  })

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: string }) => {
      const { error } = await supabase
        .from('transactions')
        .update({ status: newStatus })
        .eq('id', id)
      if (error) throw error
      return { id, newStatus }
    },
    onSuccess: ({ id, newStatus }) => {
      // Optimistically update the transaction status in the local cache
      queryClient.setQueryData(['reconciliation'], (old: ReconciliationData | undefined) => {
        if (!old) return old
        return {
          ...old,
          transactions: old.transactions.map((t) =>
            t.id === id ? { ...t, status: newStatus as Transaction['status'] } : t
          ),
          // Keep full-table stats from RPC — don't recompute from the 50-row subset
        }
      })
      // Refetch to get accurate full-table stats from the RPC
      queryClient.invalidateQueries({ queryKey: ['reconciliation'] })
    },
  })

  const reconcileTransaction = async (id: string) => {
    await updateStatusMutation.mutateAsync({ id, newStatus: 'Reconciled' })
  }

  const flagTransaction = async (id: string) => {
    await updateStatusMutation.mutateAsync({ id, newStatus: 'Flagged' })
  }

  // AI batch categorization — calls Gemini-powered edge function with rule-based fallback
  const categorizeMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('categorize-transactions')
      if (error) {
        // Extract real error from FunctionsHttpError context
        let errorMessage = error.message
        try {
          const ctx = (error as any)?.context
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json()
            errorMessage = body?.error || errorMessage
          }
        } catch { /* ignore parse failures */ }
        throw new Error(errorMessage)
      }
      return (data?.count ?? 0) as number
    },
    onSuccess: (count) => {
      toast.success(`Categorized ${count} transaction${count !== 1 ? 's' : ''}.`)
      queryClient.invalidateQueries({ queryKey: ['reconciliation'] })
    },
    onError: (error: any) => {
      toast.error('Categorization failed: ' + error.message)
    },
  })

  return {
    transactions: data?.transactions ?? [],
    stats: data?.stats ?? { total: 0, reconciled: 0, pending: 0, flagged: 0, matchRate: 0 },
    loading: isLoading,
    processing: updateStatusMutation.isPending ? updateStatusMutation.variables?.id ?? null : null,
    reconcileTransaction,
    flagTransaction,
    runCategorization: () => categorizeMutation.mutateAsync(),
    categorizing: categorizeMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['reconciliation'] }),
  }
}
