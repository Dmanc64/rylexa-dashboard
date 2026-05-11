import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type AuditEntry = {
  id: string
  table_name: string
  record_id: string | null
  action: 'INSERT' | 'UPDATE' | 'DELETE'
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  user_id: string | null
  user_email: string | null
  user_role: string | null
  created_at: string
}

export type AuditFilters = {
  table_name?: string
  action?: string
  user_email?: string
  date_from?: string
  date_to?: string
  record_id?: string
}

const PAGE_SIZE = 25

export function useAuditLog(filters: AuditFilters = {}, page: number = 0) {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [totalCount, setTotalCount] = useState(0)

  const fetchLogs = useCallback(async () => {
    setLoading(true)

    let query = supabase
      .from('audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (filters.table_name) {
      query = query.eq('table_name', filters.table_name)
    }
    if (filters.action) {
      query = query.eq('action', filters.action)
    }
    if (filters.user_email) {
      query = query.ilike('user_email', `%${filters.user_email}%`)
    }
    if (filters.date_from) {
      query = query.gte('created_at', filters.date_from)
    }
    if (filters.date_to) {
      query = query.lte('created_at', `${filters.date_to}T23:59:59.999Z`)
    }
    if (filters.record_id) {
      query = query.eq('record_id', filters.record_id)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('Audit log fetch error:', error.message)
      setLogs([])
      setTotalCount(0)
    } else {
      setLogs((data as AuditEntry[]) || [])
      setTotalCount(count || 0)
    }

    setLoading(false)
  }, [filters.table_name, filters.action, filters.user_email, filters.date_from, filters.date_to, filters.record_id, page])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  return { logs, loading, totalCount, pageSize: PAGE_SIZE, refetch: fetchLogs }
}
