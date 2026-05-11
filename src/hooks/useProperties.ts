import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'

export type PropertyMetric = {
  id: string
  name: string
  city: string
  address: string
  image_url: string | null
  total_units: number
  occupied_units: number
  occupancy_rate: number
  projected_revenue: number
}

async function fetchProperties(): Promise<PropertyMetric[]> {
  // Single query to the property_metrics view (replaces N+1 pattern)
  const { data, error } = await supabase
    .from('property_metrics')
    .select('property_id, property_name, city, address, image_url, total_units, occupied_units, occupancy_rate, projected_revenue')
    .order('property_name')

  if (error) throw error

  return (data ?? []).map((row: any) => ({
    id: row.property_id,
    name: row.property_name,
    city: row.city,
    address: row.address,
    image_url: row.image_url || null,
    total_units: Number(row.total_units) || 0,
    occupied_units: Number(row.occupied_units) || 0,
    occupancy_rate: Number(row.occupancy_rate) || 0,
    projected_revenue: Number(row.projected_revenue) || 0,
  }))
}

export function useProperties() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['properties'],
    queryFn: fetchProperties,
  })

  return {
    properties: data ?? [],
    loading: isLoading,
    error,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['properties'] }),
  }
}
