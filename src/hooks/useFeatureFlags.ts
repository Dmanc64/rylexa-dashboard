import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type FeatureFlag = {
  key: string
  value: boolean
  description: string | null
}

async function fetchFlags(): Promise<FeatureFlag[]> {
  const { data, error } = await supabase
    .from('feature_flags')
    .select('key, value, description')
    .order('key')

  if (error) throw error
  return data ?? []
}

export function useFeatureFlags() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['feature-flags'],
    queryFn: fetchFlags,
    staleTime: 5 * 60 * 1000, // flags rarely change — cache 5 min
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      const { error } = await supabase
        .from('feature_flags')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)
      if (error) throw error
      return { key, value }
    },
    onSuccess: ({ key, value }) => {
      queryClient.setQueryData(['feature-flags'], (old: FeatureFlag[] | undefined) =>
        (old ?? []).map((f) => (f.key === key ? { ...f, value } : f))
      )
    },
    onError: (err: Error) => {
      toast.error('Failed to toggle flag: ' + err.message)
    },
  })

  const flags = data ?? []
  const flagMap = Object.fromEntries(flags.map((f) => [f.key, f.value]))

  return {
    flags,
    loading: isLoading,
    isEnabled: (key: string) => flagMap[key] === true,
    toggleFlag: (key: string, value: boolean) => toggleMutation.mutateAsync({ key, value }),
    toggling: toggleMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['feature-flags'] }),
  }
}
