import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import type { VendorAvailabilitySlot, VendorUnavailableDate } from '@/hooks/useVendorUpgrade'

// ── Types ──

export type CalendarWorkOrder = {
  id: string
  title: string
  priority: string
  status: string
  scheduled_date: string | null
  due_date: string | null
  vendor_id: string | null
  unit_id: string | null
  vendors?: {
    id: string
    company_name: string | null
    contact_name: string | null
  } | null
  units?: {
    name: string
    properties?: { name: string } | null
  } | null
  tenants?: {
    first_name: string
    last_name: string
  } | null
}

// ── Calendar Data Hook ──

export function useMaintenanceCalendar(year: number, month: number) {
  const monthStart = format(startOfMonth(new Date(year, month)), 'yyyy-MM-dd')
  const monthEnd = format(endOfMonth(new Date(year, month)), 'yyyy-MM-dd')

  const { data: workOrders = [], isLoading } = useQuery({
    queryKey: ['maintenance-calendar', year, month],
    queryFn: async (): Promise<CalendarWorkOrder[]> => {
      const { data, error } = await supabase
        .from('work_orders')
        .select(`
          id, title, priority, status, scheduled_date, due_date, vendor_id, unit_id,
          vendors:vendor_id(id, company_name, contact_name),
          units!work_orders_unit_id_fkey(name, properties(name)),
          tenants:tenant_id(first_name, last_name)
        `)
        .eq('archived', false)
        .not('scheduled_date', 'is', null)
        .gte('scheduled_date', monthStart)
        .lte('scheduled_date', monthEnd)
        .order('scheduled_date', { ascending: true })

      if (error) throw error
      return (data ?? []) as unknown as CalendarWorkOrder[]
    },
    staleTime: 30_000,
  })

  // Group work orders by scheduled_date string (memoized)
  const groupedByDate = useMemo(() => {
    const grouped: Record<string, CalendarWorkOrder[]> = {}
    for (const wo of workOrders) {
      if (!wo.scheduled_date) continue
      const key = wo.scheduled_date // Already yyyy-MM-dd from DB
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(wo)
    }
    return grouped
  }, [workOrders])

  return { workOrders, groupedByDate, loading: isLoading }
}

// ── Schedule Work Order Mutation ──

export function useScheduleWorkOrder() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      workOrderId: string
      scheduled_date?: string | null
      due_date?: string | null
    }) => {
      const updates: Record<string, unknown> = {}
      if (params.scheduled_date !== undefined) updates.scheduled_date = params.scheduled_date
      if (params.due_date !== undefined) updates.due_date = params.due_date

      const { error } = await supabase
        .from('work_orders')
        .update(updates)
        .eq('id', params.workOrderId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-calendar'] })
    },
  })
}

// ── Vendor Date Availability Check ──

export function useVendorDateAvailability(vendorId: string | null, dateStr: string | null) {
  return useQuery({
    queryKey: ['vendor-date-availability', vendorId, dateStr],
    queryFn: async () => {
      if (!vendorId || !dateStr) {
        return { available: false, status: 'unknown' as const, loading: false }
      }

      const targetDate = new Date(dateStr + 'T12:00:00') // Avoid timezone shift
      const dayOfWeek = targetDate.getDay() // 0=Sun, 6=Sat

      const [scheduleRes, blockedRes] = await Promise.all([
        supabase
          .from('vendor_availability')
          .select('*')
          .eq('vendor_id', vendorId)
          .eq('day_of_week', dayOfWeek),
        supabase
          .from('vendor_unavailable_dates')
          .select('*')
          .eq('vendor_id', vendorId)
          .eq('date', dateStr),
      ])

      const schedule = (scheduleRes.data ?? []) as VendorAvailabilitySlot[]
      const blocked = (blockedRes.data ?? []) as VendorUnavailableDate[]

      // Check if date is blocked
      if (blocked.length > 0) {
        return { available: false, status: 'blocked' as const, reason: blocked[0].reason }
      }

      // Check if vendor has any availability data at all
      const { count } = await supabase
        .from('vendor_availability')
        .select('id', { count: 'exact', head: true })
        .eq('vendor_id', vendorId)

      if (!count || count === 0) {
        return { available: false, status: 'no_schedule' as const }
      }

      // Check if available on this day of week
      if (schedule.length === 0) {
        return { available: false, status: 'off_schedule' as const }
      }

      return { available: true, status: 'available' as const, slots: schedule }
    },
    enabled: !!vendorId && !!dateStr,
    staleTime: 60_000,
  })
}
