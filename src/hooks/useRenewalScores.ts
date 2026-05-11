import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type RenewalScore = {
  id: string
  lease_id: string
  score: number
  risk_level: 'Low' | 'Medium' | 'High'
  factors: {
    tenure_months: number
    days_to_expiry: number
    payment_ratio: number
    total_transactions: number
    paid_transactions: number
    rent_amount: number
    avg_property_rent: number
    rent_vs_avg_ratio: number
  }
  scored_at: string
  recommendation: string | null
  recommended_action: 'Auto-Renew' | 'Offer Incentive' | 'Schedule Meeting' | 'Prepare Turnover' | 'Urgent Outreach' | null
  // Joined from lease_details_view
  tenant_name?: string
  property_name?: string
  unit_name?: string
  rent_amount?: number
  end_date?: string
}

async function fetchScores(): Promise<RenewalScore[]> {
  // Fetch scores joined with lease details
  const { data, error } = await supabase
    .from('lease_renewal_scores')
    .select(`
      id, lease_id, score, risk_level, factors, scored_at, recommendation, recommended_action,
      leases (
        rent_amount, end_date,
        tenants ( first_name, last_name ),
        units ( name, properties ( name ) )
      )
    `)
    .order('score', { ascending: true })

  if (error) throw error

  return (data ?? []).map((s: any) => ({
    id: s.id,
    lease_id: s.lease_id,
    score: s.score,
    risk_level: s.risk_level,
    factors: s.factors,
    scored_at: s.scored_at,
    recommendation: s.recommendation,
    recommended_action: s.recommended_action,
    tenant_name: s.leases?.tenants
      ? `${s.leases.tenants.first_name} ${s.leases.tenants.last_name}`
      : 'Unknown',
    property_name: s.leases?.units?.properties?.name ?? 'Unknown',
    unit_name: s.leases?.units?.name ?? 'Unknown',
    rent_amount: s.leases?.rent_amount,
    end_date: s.leases?.end_date,
  }))
}

export function useRenewalScores() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['renewal-scores'],
    queryFn: fetchScores,
  })

  const runScoringMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('score_lease_renewals')
      if (error) throw error
      return (data ?? 0) as number
    },
    onSuccess: (count) => {
      toast.success(`Scored ${count} lease${count !== 1 ? 's' : ''} for renewal risk.`)
      queryClient.invalidateQueries({ queryKey: ['renewal-scores'] })
    },
    onError: (error: any) => {
      toast.error('Scoring failed: ' + error.message)
    },
  })

  return {
    scores: data ?? [],
    loading: isLoading,
    scoring: runScoringMutation.isPending,
    runScoring: () => runScoringMutation.mutateAsync(),
    refresh: () => queryClient.invalidateQueries({ queryKey: ['renewal-scores'] }),
  }
}
