import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type Vendor = {
  id: string
  company_name: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  trade_type: string | null
  payment_type: string | null
  is_1099: boolean
  do_not_use: boolean
  insurance_exp?: string
  hourly_rate: number | null
  tax_id: string | null
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
}

export type VendorInsert = Omit<Vendor, 'id'>
export type VendorUpdate = Partial<Omit<Vendor, 'id'>> & { id: string }

async function fetchVendors(): Promise<{ vendors: Vendor[]; trades: string[] }> {
  const { data, error } = await supabase
    .from('vendors')
    .select('id, company_name, contact_name, email, phone, trade_type, payment_type, is_1099, do_not_use, insurance_exp, hourly_rate, tax_id, address_street, address_city, address_state, address_zip')
    .order('company_name', { ascending: true })

  if (error) throw error

  const vendors = (data ?? []) as Vendor[]
  // Split comma-separated trade_type strings into individual trades
  const trades = Array.from(
    new Set(
      vendors
        .flatMap((v) =>
          (v.trade_type || '').split(',').map((t) => t.trim()).filter(Boolean)
        )
    )
  ).sort() as string[]

  return { vendors, trades }
}

export function useVendors() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['vendors'],
    queryFn: fetchVendors,
  })

  const toggleMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: boolean }) => {
      const { error } = await supabase
        .from('vendors')
        .update({ do_not_use: newStatus })
        .eq('id', id)
      if (error) throw error
      return { id, newStatus }
    },
    onMutate: async ({ id, newStatus }) => {
      await queryClient.cancelQueries({ queryKey: ['vendors'] })
      const prev = queryClient.getQueryData(['vendors'])
      queryClient.setQueryData(['vendors'], (old: any) => {
        if (!old) return old
        return {
          ...old,
          vendors: old.vendors.map((v: Vendor) =>
            v.id === id ? { ...v, do_not_use: newStatus } : v
          ),
        }
      })
      return { prev }
    },
    onSettled: () => {
      // Always refetch after mutation settles to sync with server state
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['vendors'], context.prev)
      toast.error('Error updating vendor status')
    },
  })

  const createMutation = useMutation({
    mutationFn: async (vendor: VendorInsert) => {
      const { data, error } = await supabase
        .from('vendors')
        .insert(vendor)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Vendor onboarded successfully')
    },
    onError: (error: any) => {
      toast.error('Error onboarding vendor: ' + error.message)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: VendorUpdate) => {
      const { error } = await supabase
        .from('vendors')
        .update(updates)
        .eq('id', id)
      if (error) throw error
      return { id, updates }
    },
    onMutate: async ({ id, ...updates }) => {
      await queryClient.cancelQueries({ queryKey: ['vendors'] })
      const prev = queryClient.getQueryData(['vendors'])
      queryClient.setQueryData(['vendors'], (old: any) => {
        if (!old) return old
        return {
          ...old,
          vendors: old.vendors.map((v: Vendor) =>
            v.id === id ? { ...v, ...updates } : v
          ),
        }
      })
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(['vendors'], context.prev)
      toast.error('Error updating vendor')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendors'] })
      toast.success('Vendor updated successfully')
    },
  })

  const toggleStatus = (id: string, currentStatus: boolean) => {
    toggleMutation.mutate({ id, newStatus: !currentStatus })
  }

  return {
    vendors: data?.vendors ?? [],
    trades: data?.trades ?? [],
    loading: isLoading,
    saving: createMutation.isPending || updateMutation.isPending,
    toggleStatus,
    createVendor: (vendor: VendorInsert) => createMutation.mutateAsync(vendor),
    updateVendor: (vendor: VendorUpdate) => updateMutation.mutateAsync(vendor),
    refresh: () => queryClient.invalidateQueries({ queryKey: ['vendors'] }),
  }
}
