import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type Owner = {
  id: string
  user_id: string | null
  full_name: string
  email: string
  phone: string | null
  company_name: string | null
  notes: string | null
  created_at: string
  property_count?: number
  tax_id: string | null
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
}

export type OwnerInsert = Omit<Owner, 'id' | 'created_at' | 'property_count'>
export type OwnerUpdate = Partial<Omit<Owner, 'id' | 'created_at' | 'property_count'>> & { id: string }

async function fetchOwners(): Promise<Owner[]> {
  const { data, error } = await supabase
    .from('owners')
    .select('id, user_id, full_name, email, phone, company_name, notes, created_at, tax_id, address_street, address_city, address_state, address_zip, properties(id)')
    .order('full_name', { ascending: true })

  if (error) throw error

  return (data ?? []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone,
    company_name: row.company_name,
    notes: row.notes,
    created_at: row.created_at,
    property_count: row.properties?.length ?? 0,
    tax_id: row.tax_id,
    address_street: row.address_street,
    address_city: row.address_city,
    address_state: row.address_state,
    address_zip: row.address_zip,
  }))
}

export function useOwners() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['owners'],
    queryFn: fetchOwners,
  })

  const createMutation = useMutation({
    mutationFn: async (owner: OwnerInsert) => {
      const { data, error } = await supabase
        .from('owners')
        .insert(owner)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owners'] })
      toast.success('Owner added successfully')
    },
    onError: (error: any) => {
      toast.error('Error adding owner: ' + error.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: OwnerUpdate) => {
      const { error } = await supabase
        .from('owners')
        .update(updates)
        .eq('id', id)
      if (error) throw error
      return { id, updates }
    },
    onMutate: async ({ id, ...updates }) => {
      await queryClient.cancelQueries({ queryKey: ['owners'] })
      const prev = queryClient.getQueryData(['owners'])
      queryClient.setQueryData(['owners'], (old: any) => {
        if (!old) return old
        return old.map((o: Owner) => o.id === id ? { ...o, ...updates } : o)
      })
      return { prev }
    },
    onError: (_err: any, _vars: any, context: any) => {
      if (context?.prev) queryClient.setQueryData(['owners'], context.prev)
      toast.error('Error updating owner')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owners'] })
      toast.success('Owner updated successfully')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('owners')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owners'] })
      toast.success('Owner removed')
    },
    onError: (error: any) => {
      toast.error('Error removing owner: ' + error.message)
    },
  })

  return {
    owners: data ?? [],
    loading: isLoading,
    saving: createMutation.isPending || updateMutation.isPending,
    createOwner: (owner: OwnerInsert) => createMutation.mutateAsync(owner),
    updateOwner: (owner: OwnerUpdate) => updateMutation.mutateAsync(owner),
    deleteOwner: (id: string) => deleteMutation.mutateAsync(id),
    refresh: () => queryClient.invalidateQueries({ queryKey: ['owners'] }),
  }
}
