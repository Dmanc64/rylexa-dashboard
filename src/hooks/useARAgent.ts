import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'

export type ARAction = {
  id: string
  tenant_id: string
  lease_id: string | null
  action_type: 'REMINDER_1' | 'REMINDER_2' | 'REMINDER_3' | 'LATE_FEE' | 'DEMAND_LETTER' | 'ESCALATION'
  month: string
  amount_owed: number | null
  status: 'completed' | 'overridden' | 'paused'
  created_at: string
  // Joined
  tenant_name?: string
  tenant_email?: string
}

export type ARStats = {
  totalActions: number
  reminders: number
  lateFees: number
  demandLetters: number
  escalations: number
  paused: number
}

async function fetchARData(): Promise<{ actions: ARAction[]; stats: ARStats }> {
  const { data, error } = await supabase
    .from('ar_actions')
    .select(`
      id, tenant_id, lease_id, action_type, month, amount_owed, status, created_at,
      tenants ( first_name, last_name, email )
    `)
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) throw error

  const actions: ARAction[] = (data ?? []).map((a: any) => ({
    id: a.id,
    tenant_id: a.tenant_id,
    lease_id: a.lease_id,
    action_type: a.action_type,
    month: a.month,
    amount_owed: a.amount_owed,
    status: a.status,
    created_at: a.created_at,
    tenant_name: a.tenants
      ? `${a.tenants.first_name} ${a.tenants.last_name}`
      : 'Unknown',
    tenant_email: a.tenants?.email,
  }))

  const stats: ARStats = {
    totalActions: actions.length,
    reminders: actions.filter(a => a.action_type.startsWith('REMINDER')).length,
    lateFees: actions.filter(a => a.action_type === 'LATE_FEE').length,
    demandLetters: actions.filter(a => a.action_type === 'DEMAND_LETTER').length,
    escalations: actions.filter(a => a.action_type === 'ESCALATION').length,
    paused: actions.filter(a => a.status === 'paused').length,
  }

  return { actions, stats }
}

export function useARAgent() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['ar-agent'],
    queryFn: fetchARData,
  })

  const runWorkflowMutation = useMutation({
    mutationFn: async () => {
      const { data: result, error } = await supabase.functions.invoke('ar-agent', {
        body: {},
      })

      if (error) {
        let msg = error.message || 'Workflow failed'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || errBody?.message || msg
        }
        throw new Error(msg)
      }

      return result
    },
    onSuccess: (result) => {
      toast.success(`AR Agent processed ${result.processed} tenants (${result.skipped} skipped)`)
      queryClient.invalidateQueries({ queryKey: ['ar-agent'] })
    },
    onError: (error: any) => {
      toast.error('AR Workflow failed: ' + error.message)
    },
  })

  const pauseTenantMutation = useMutation({
    mutationFn: async ({ tenantId, month }: { tenantId: string; month: string }) => {
      const { error } = await supabase
        .from('ar_actions')
        .update({ status: 'paused' })
        .eq('tenant_id', tenantId)
        .eq('month', month)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Tenant paused from AR workflow')
      queryClient.invalidateQueries({ queryKey: ['ar-agent'] })
    },
    onError: (error: any) => {
      toast.error('Pause failed: ' + error.message)
    },
  })

  return {
    actions: data?.actions ?? [],
    stats: data?.stats ?? { totalActions: 0, reminders: 0, lateFees: 0, demandLetters: 0, escalations: 0, paused: 0 },
    loading: isLoading,
    running: runWorkflowMutation.isPending,
    runWorkflow: () => runWorkflowMutation.mutateAsync(),
    pauseTenant: (tenantId: string, month: string) => pauseTenantMutation.mutateAsync({ tenantId, month }),
    refresh: () => queryClient.invalidateQueries({ queryKey: ['ar-agent'] }),
  }
}
