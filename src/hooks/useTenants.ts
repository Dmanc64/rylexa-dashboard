import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'

export type Tenant = {
  id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  status: 'Active' | 'Past' | 'Lead'
  property_name: string
  unit_name: string
  lease_status: string | null
}

export type TenantCounts = {
  all: number
  active: number
  past: number
  lead: number
}

const PAGE_SIZE = 25

async function fetchTenants(
  page: number,
  statusFilter: string,
  search: string
): Promise<{ tenants: Tenant[]; totalCount: number }> {
  const from = page * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  let query = supabase
    .from('tenant_directory_view')
    .select('*', { count: 'exact' })
    .order('last_name', { ascending: true })
    .range(from, to)

  if (statusFilter && statusFilter !== 'All') {
    query = query.eq('effective_status', statusFilter)
  }

  if (search) {
    // Escape PostgREST special characters to prevent filter injection
    const escaped = search.replace(/[%_,.()"\\]/g, '')
    if (escaped) {
      query = query.or(
        `first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,email.ilike.%${escaped}%,property_name.ilike.%${escaped}%`
      )
    }
  }

  const { data, error, count } = await query

  if (error) throw error

  const tenants: Tenant[] = (data ?? []).map((t: any) => ({
    id: t.id,
    first_name: t.first_name,
    last_name: t.last_name,
    email: t.email,
    phone: t.phone,
    status: t.effective_status,
    property_name: t.property_name,
    unit_name: t.unit_name,
    lease_status: t.lease_status,
  }))

  return { tenants, totalCount: count ?? 0 }
}

async function fetchCounts(search: string): Promise<TenantCounts> {
  const { data, error } = await supabase.rpc('get_tenant_directory_counts', {
    p_search: search || null,
  })
  if (error) throw error
  return data as TenantCounts
}

export function useTenants(page = 0, statusFilter = 'All', search = '') {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['tenants', page, statusFilter, search],
    queryFn: () => fetchTenants(page, statusFilter, search),
  })

  const { data: counts } = useQuery({
    queryKey: ['tenant-counts', search],
    queryFn: () => fetchCounts(search),
  })

  return {
    tenants: data?.tenants ?? [],
    totalCount: data?.totalCount ?? 0,
    counts: counts ?? { all: 0, active: 0, past: 0, lead: 0 },
    page,
    pageSize: PAGE_SIZE,
    loading: isLoading,
    error,
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: ['tenants'] })
      queryClient.invalidateQueries({ queryKey: ['tenant-counts'] })
    },
  }
}
