import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──

export type SMSStatus = 'pending' | 'sent' | 'failed'

export type SMSLogEntry = {
  id: string
  recipient_phone: string | null
  recipient_name: string | null
  subject: string
  body: string
  status: SMSStatus
  sms_sid: string | null
  error_message: string | null
  created_at: string
  sent_at: string | null
}

export type SMSTemplate = {
  id: string
  slug: string
  body: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type SMSFilters = {
  status?: SMSStatus
  search?: string
  from_date?: string
  to_date?: string
}

export type SMSStats = {
  sent_today: number
  pending: number
  failed: number
  total: number
}

// ── SMS Log Hook ──

export function useSMSLog(filters: SMSFilters = {}) {
  return useQuery({
    queryKey: ['sms-log', filters],
    queryFn: async (): Promise<SMSLogEntry[]> => {
      let query = supabase
        .from('notification_queue')
        .select('id, recipient_phone, recipient_name, subject, body, status, sms_sid, error_message, created_at, sent_at')
        .eq('channel', 'sms')
        .order('created_at', { ascending: false })
        .limit(200)

      if (filters.status) {
        query = query.eq('status', filters.status)
      }
      if (filters.search) {
        // Escape PostgREST special characters to prevent filter injection
        const escaped = filters.search.replace(/[%_,.()"\\\\\\/]/g, '')
        if (escaped) {
          query = query.or(`recipient_name.ilike.%${escaped}%,recipient_phone.ilike.%${escaped}%,body.ilike.%${escaped}%`)
        }
      }
      if (filters.from_date) {
        query = query.gte('created_at', filters.from_date)
      }
      if (filters.to_date) {
        query = query.lte('created_at', filters.to_date)
      }

      const { data, error } = await query
      if (error) throw error
      return (data ?? []) as SMSLogEntry[]
    },
    staleTime: 30_000, // 30s
  })
}

// ── SMS Stats Hook ──

export function useSMSStats() {
  return useQuery({
    queryKey: ['sms-stats'],
    queryFn: async (): Promise<SMSStats> => {
      const today = new Date().toISOString().split('T')[0]

      const [sentTodayRes, pendingRes, failedRes, totalRes] = await Promise.all([
        supabase
          .from('notification_queue')
          .select('id', { count: 'exact', head: true })
          .eq('channel', 'sms')
          .eq('status', 'sent')
          .gte('sent_at', today),
        supabase
          .from('notification_queue')
          .select('id', { count: 'exact', head: true })
          .eq('channel', 'sms')
          .eq('status', 'pending'),
        supabase
          .from('notification_queue')
          .select('id', { count: 'exact', head: true })
          .eq('channel', 'sms')
          .eq('status', 'failed'),
        supabase
          .from('notification_queue')
          .select('id', { count: 'exact', head: true })
          .eq('channel', 'sms'),
      ])

      return {
        sent_today: sentTodayRes.count ?? 0,
        pending: pendingRes.count ?? 0,
        failed: failedRes.count ?? 0,
        total: totalRes.count ?? 0,
      }
    },
    staleTime: 15_000, // 15s
  })
}

// ── SMS Templates Hook ──

export function useSMSTemplates() {
  return useQuery({
    queryKey: ['sms-templates'],
    queryFn: async (): Promise<SMSTemplate[]> => {
      const { data, error } = await supabase
        .from('sms_templates')
        .select('*')
        .order('slug')
      if (error) throw error
      return (data ?? []) as SMSTemplate[]
    },
    staleTime: 5 * 60_000, // 5 min
  })
}

// ── Update SMS Template ──

export function useUpdateSMSTemplate() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, body, is_active }: { id: string; body?: string; is_active?: boolean }) => {
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body !== undefined) updates.body = body
      if (is_active !== undefined) updates.is_active = is_active

      const { error } = await supabase
        .from('sms_templates')
        .update(updates)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-templates'] })
    },
  })
}

// ── Helper: trigger send-sms edge function (fire and forget) ──

async function triggerSMSProcessing() {
  try {
    await supabase.functions.invoke('send-sms', { method: 'POST', body: {} })
  } catch {
    // Non-blocking — the queue will be picked up by cron or manual retry
  }
}

// ── Send Single SMS ──

export function useSendSMS() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      recipient_phone: string
      recipient_name: string
      body: string
    }) => {
      const { error } = await supabase.from('notification_queue').insert({
        recipient_phone: params.recipient_phone,
        recipient_name: params.recipient_name,
        subject: 'Manual SMS',
        body: params.body,
        channel: 'sms',
        status: 'pending',
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-log'] })
      queryClient.invalidateQueries({ queryKey: ['sms-stats'] })
      // Auto-process: trigger the edge function to send immediately
      triggerSMSProcessing().then(() => {
        // Refresh data after processing completes
        queryClient.invalidateQueries({ queryKey: ['sms-log'] })
        queryClient.invalidateQueries({ queryKey: ['sms-stats'] })
      })
    },
  })
}

// ── Send Bulk SMS ──

export type BulkSMSTarget =
  | { type: 'property'; property_id: string }
  | { type: 'all_active' }
  | { type: 'custom'; recipients: Array<{ phone: string; name: string }> }

export function useSendBulkSMS() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: { target: BulkSMSTarget; body: string }) => {
      let recipients: Array<{ phone: string; name: string }> = []

      if (params.target.type === 'custom') {
        recipients = params.target.recipients
      } else {
        // Fetch recipients from DB
        let query = supabase
          .from('leases')
          .select('tenants(first_name, last_name, phone)')
          .eq('status', 'Active')

        if (params.target.type === 'property') {
          query = query.eq('units.property_id', params.target.property_id)
        }

        // Use a different approach — get tenants via leases → units → property
        const { data: leases } = await supabase
          .from('leases')
          .select(`
            tenants(first_name, last_name, phone),
            units(property_id)
          `)
          .eq('status', 'Active')

        if (leases) {
          for (const lease of leases) {
            const t = lease.tenants as any
            const u = lease.units as any
            if (!t?.phone) continue

            if (params.target.type === 'property' && u?.property_id !== params.target.property_id) continue

            recipients.push({
              phone: t.phone,
              name: t.first_name || t.last_name || 'Tenant',
            })
          }
        }
      }

      if (recipients.length === 0) {
        throw new Error('No recipients with phone numbers found.')
      }

      // Deduplicate by phone
      const seen = new Set<string>()
      const unique = recipients.filter(r => {
        if (seen.has(r.phone)) return false
        seen.add(r.phone)
        return true
      })

      // Insert all at once
      const rows = unique.map(r => ({
        recipient_phone: r.phone,
        recipient_name: r.name,
        subject: 'Bulk SMS',
        body: params.body.replace(/\{\{tenant_name\}\}/g, r.name),
        channel: 'sms' as const,
        status: 'pending' as const,
      }))

      const { error } = await supabase.from('notification_queue').insert(rows)
      if (error) throw error

      return { queued: unique.length }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-log'] })
      queryClient.invalidateQueries({ queryKey: ['sms-stats'] })
      // Auto-process: trigger the edge function to send immediately
      triggerSMSProcessing().then(() => {
        queryClient.invalidateQueries({ queryKey: ['sms-log'] })
        queryClient.invalidateQueries({ queryKey: ['sms-stats'] })
      })
    },
  })
}

// ── Process SMS Queue (trigger edge function) ──

export function useProcessSMSQueue() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-sms', {
        method: 'POST',
        body: {},
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sms-log'] })
      queryClient.invalidateQueries({ queryKey: ['sms-stats'] })
    },
  })
}

// ── Fetch recipients for compose modal ──

export async function fetchSMSRecipients() {
  const { data: leases } = await supabase
    .from('leases')
    .select(`
      tenants(id, first_name, last_name, phone),
      units(name, properties(id, name))
    `)
    .eq('status', 'Active')

  if (!leases) return []

  // Tenants with multiple active leases would otherwise appear once per lease
  // with the same id → React duplicate-key warning. Dedupe by tenant id;
  // keep the first lease seen and note extra units in the unit_name field.
  const byTenant = new Map<string, {
    id: string
    name: string
    phone: string
    property_id: string
    property_name: string
    unit_name: string
  }>()

  for (const lease of leases) {
    const t = lease.tenants as any
    const u = lease.units as any
    if (!t?.id || !t?.phone) continue

    const unitLabel = u?.name || ''
    const existing = byTenant.get(t.id)
    if (existing) {
      if (unitLabel && !existing.unit_name.split(', ').includes(unitLabel)) {
        existing.unit_name = existing.unit_name
          ? `${existing.unit_name}, ${unitLabel}`
          : unitLabel
      }
      continue
    }

    byTenant.set(t.id, {
      id: t.id,
      name: `${t.first_name || ''} ${t.last_name || ''}`.trim(),
      phone: t.phone,
      property_id: u?.properties?.id || '',
      property_name: u?.properties?.name || 'Unknown',
      unit_name: unitLabel,
    })
  }

  return Array.from(byTenant.values())
}
