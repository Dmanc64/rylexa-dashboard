import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type Ticket = {
  id: string
  title: string
  description: string
  priority: 'Low' | 'Normal' | 'High' | 'Emergency'
  status: 'Open' | 'In Progress' | 'Completed' | 'Closed'
  created_at: string
  unit_name: string
  property_name: string
  assigned_vendor: string
  cost: number
  notes: string
  hours_worked: number
  labor_cost: number
  invoice_amount: number | null
  materials_cost: number
  // AI triage fields (Phase 8)
  category: string | null
  ai_priority: string | null
  ai_confidence: number | null
  // Ledger commit tracking
  ledger_committed: boolean
}

export type Vendor = {
  id: string
  company_name: string | null
  contact_name: string | null
}

async function fetchMaintenanceData() {
  const [ticketRes, vendorRes] = await Promise.all([
    supabase.from('work_orders').select(`*, units (name, properties(name))`).order('created_at', { ascending: false }),
    supabase.from('vendors').select('id, company_name, contact_name').order('contact_name', { ascending: true }),
  ])

  if (ticketRes.error) throw ticketRes.error
  if (vendorRes.error) throw vendorRes.error

  const tickets: Ticket[] = (ticketRes.data ?? []).map((t: any) => ({
    ...t,
    unit_name: t.units?.name || 'General',
    property_name: t.units?.properties?.name || 'Unknown Property',
  }))

  return { tickets, vendors: (vendorRes.data ?? []) as Vendor[] }
}

export function useMaintenance() {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['maintenance'],
    queryFn: fetchMaintenanceData,
  })

  const mutation = useMutation({
    mutationFn: async ({ ticketId, updates }: { ticketId: string; updates: Partial<Ticket> }) => {
      const { error } = await supabase.rpc('update_ticket_status', {
        ticket_id: ticketId,
        new_status: updates.status,
        vendor_name: updates.assigned_vendor,
        repair_cost: updates.cost,
        manager_notes: updates.notes,
      })
      if (error) throw error
      return { ticketId, updates }
    },
    onSuccess: ({ ticketId, updates }) => {
      // Optimistic-style: update cache immediately
      queryClient.setQueryData(['maintenance'], (old: any) => {
        if (!old) return old
        return {
          ...old,
          tickets: old.tickets.map((t: Ticket) =>
            t.id === ticketId ? { ...t, ...updates } : t
          ),
        }
      })
    },
    onError: (error: any) => {
      toast.error('Error updating ticket: ' + error.message)
    },
  })

  const updateTicket = async (ticketId: string, updates: Partial<Ticket>) => {
    try {
      await mutation.mutateAsync({ ticketId, updates })
      return true
    } catch {
      return false
    }
  }

  return {
    tickets: data?.tickets ?? [],
    vendors: data?.vendors ?? [],
    loading: isLoading,
    error,
    saving: mutation.isPending,
    updateTicket,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['maintenance'] }),
  }
}
