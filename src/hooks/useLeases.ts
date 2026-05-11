import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'

export type LeaseDetail = {
  lease_id: string
  property_name: string
  unit_name: string
  first_name: string
  last_name: string
  rent_amount: number
  status: string
  end_date: string | null
  // Affordability fields (from lease_details_view)
  is_restricted?: boolean
  ami_percentage?: number | null
  max_gross_rent?: number | null
  utility_allowance?: number | null
  tenant_portion?: number | null
  subsidy_amount?: number | null
  subsidy_source?: string | null
  // Insurance fields (from lease_details_view)
  insurance_required?: boolean
  insurance_status?: string | null
  insurance_expiration?: string | null
}

export type MasterUnit = {
  unit_name: string
  property_name: string
}

async function fetchFilters(): Promise<{ properties: string[]; units: MasterUnit[] }> {
  // Paginate to overcome PostgREST 1000-row default limit (units table has 1000+ rows)
  const PAGE_SIZE = 1000
  let allData: any[] = []
  let from = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('units')
      .select(`name, properties (name)`)
      .order('name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    allData = allData.concat(data ?? [])
    hasMore = (data?.length ?? 0) === PAGE_SIZE
    from += PAGE_SIZE
  }

  const units: MasterUnit[] = allData.map((u: any) => ({
    unit_name: u.name,
    property_name: u.properties?.name || 'Unknown',
  }))

  const properties = Array.from(new Set(units.map((u) => u.property_name))).sort()

  return { properties, units }
}

async function fetchLeasesByProperty(propName: string): Promise<LeaseDetail[]> {
  if (!propName) return []

  // Paginate to handle growing lease count (approaching 1000-row PostgREST limit)
  const PAGE_SIZE = 1000
  let allData: any[] = []
  let from = 0
  let hasMore = true

  while (hasMore) {
    let query = supabase.from('lease_details_view').select('*')
    if (propName !== 'All Properties') {
      query = query.eq('property_name', propName)
    }

    const { data, error } = await query
      .order('unit_name', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw error
    allData = allData.concat(data ?? [])
    hasMore = (data?.length ?? 0) === PAGE_SIZE
    from += PAGE_SIZE
  }

  return allData
}

export function useLeases(selectedProperty = 'All Properties') {
  const queryClient = useQueryClient()

  // Filters are fetched once and cached
  const { data: filterData, isLoading: filtersLoading } = useQuery({
    queryKey: ['lease-filters'],
    queryFn: fetchFilters,
  })

  // Leases are fetched reactively based on selectedProperty
  const { data: leases, isLoading: leasesLoading } = useQuery({
    queryKey: ['leases', selectedProperty],
    queryFn: () => fetchLeasesByProperty(selectedProperty),
    enabled: !!selectedProperty,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['leases', selectedProperty] })
  }

  return {
    leases: leases ?? [],
    properties: filterData?.properties ?? [],
    units: filterData?.units ?? [],
    loading: { filters: filtersLoading, leases: leasesLoading },
    refresh,
  }
}
