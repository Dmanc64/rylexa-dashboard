import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type DistributableProperty = {
  id: string
  name: string
  owner_id: string | null
  owner_name: string
  cash_balance: number
  reserve_requirement: number
  available_distribution: number
  status: 'Ready' | 'Low Funds'
}

export type DistributionRecord = {
  id: string
  owner_name: string
  property_name: string
  amount: number
  status: string
  created_at: string
}

async function fetchDistributionData(): Promise<{
  properties: DistributableProperty[]
  history: DistributionRecord[]
}> {
  const [propsRes, historyRes] = await Promise.all([
    supabase.from('distribution_summary').select('property_id, property_name, owner_id, owner_name, total_income, total_expenses, net_balance'),
    supabase
      .from('distributions')
      .select('id, amount, status, created_at, owners(full_name), properties(name)')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  if (propsRes.error) throw propsRes.error
  if (historyRes.error) throw historyRes.error

  const properties: DistributableProperty[] = (propsRes.data ?? []).map((row: any) => {
    const balance = Number(row.net_balance) || 0
    const reserve = 500
    const available = balance - reserve
    return {
      id: row.property_id,
      name: row.property_name,
      owner_id: row.owner_id,
      owner_name: row.owner_name || 'Unassigned',
      cash_balance: balance,
      reserve_requirement: reserve,
      available_distribution: available > 0 ? available : 0,
      status: available > 0 ? 'Ready' : 'Low Funds',
    }
  })

  const history: DistributionRecord[] = (historyRes.data ?? []).map((d: any) => ({
    id: d.id,
    owner_name: d.owners?.full_name || 'Unknown',
    property_name: d.properties?.name || 'Unknown',
    amount: Number(d.amount) || 0,
    status: d.status,
    created_at: d.created_at,
  }))

  return { properties, history }
}

export function useDistributions() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['distributions'],
    queryFn: fetchDistributionData,
  })

  const batchMutation = useMutation({
    mutationFn: async (selectedIds: string[]) => {
      const allProps = data?.properties ?? []
      const targets = allProps.filter(
        (p) => selectedIds.includes(p.id) && p.available_distribution > 0 && p.owner_id
      )
      if (targets.length === 0) return

      const today = new Date().toISOString().split('T')[0]

      // Insert distribution records for each property
      const rows = targets.map((p) => ({
        owner_id: p.owner_id!,
        property_id: p.id,
        amount: p.available_distribution,
        status: 'Completed' as const,
        period_end: today,
        processed_at: new Date().toISOString(),
        notes: 'Batch distribution',
      }))

      const { error } = await supabase.from('distributions').insert(rows)
      if (error) throw error

      // Also log to system_activity for the activity feed
      const totalAmount = targets.reduce((acc, curr) => acc + curr.available_distribution, 0)
      await supabase.from('system_activity').insert({
        event_type: 'DISTRIBUTION',
        title: `Batch Owner Payout (${targets.length} Properties)`,
        description: `Total payout of $${totalAmount.toFixed(2)} processed.`,
        actor_name: 'Finance Admin',
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['distributions'] })
      toast.success('Distributions processed successfully')
    },
    onError: (error: any) => {
      toast.error('Distribution Failed: ' + error.message)
    },
  })

  return {
    properties: data?.properties ?? [],
    history: data?.history ?? [],
    loading: isLoading,
    processing: batchMutation.isPending,
    runBatchDistribution: async (selectedIds: string[]) => {
      await batchMutation.mutateAsync(selectedIds)
    },
    refresh: () => queryClient.invalidateQueries({ queryKey: ['distributions'] }),
  }
}
