import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { toast } from 'sonner'

// ── Types ──────────────────────────────────────────────────
export type ReportType = 'rent_roll' | 'profit_loss' | 'vacancy' | 'maintenance_cost' | 'ar_aging' | 'owner_statement'

export type ReportFilters = {
  reportType: ReportType
  propertyId?: string
  dateFrom?: string
  dateTo?: string
  ownerId?: string
}

export type RentRollRow = {
  lease_id: string
  property_id: string
  property_name: string
  unit_id: string
  unit_name: string
  market_rent: number | null
  tenant_id: string
  first_name: string
  last_name: string
  tenant_email: string
  tenant_phone: string | null
  rent_amount: number
  start_date: string
  end_date: string | null
  lease_status: string
}

export type ProfitLossRow = {
  property_id: string
  property_name: string
  total_income: number
  total_expenses: number
  net_operating_income: number
}

export type VacancyRow = {
  unit_id: string
  unit_name: string
  property_id: string
  property_name: string
  status: 'vacant' | 'expiring'
  lease_end_date: string | null
  tenant_name: string | null
  days_until_expiry: number | null
}

export type MaintenanceCostRow = {
  id: string
  title: string
  property_name: string
  unit_name: string
  vendor_name: string | null
  cost: number
  status: string
  priority: string
  created_at: string
}

export type ARAgingRow = {
  lease_id: string
  tenant_id: string
  first_name: string
  last_name: string
  tenant_email: string
  unit_name: string
  property_id: string
  property_name: string
  rent_amount: number
  balance_due: number
  total_charges: number
  total_payments: number
  aging_bucket: 'current' | '0-30' | '31-60' | '61-90' | '90+'
}

export type OwnerStatementRow = {
  owner_id: string
  owner_name: string
  property_id: string
  property_name: string
  total_income: number
  total_expenses: number
  net_balance: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReportRow = any

// ── Constants ──────────────────────────────────────────────
export const REPORT_TYPE_OPTIONS: { value: ReportType; label: string; description: string; color: string }[] = [
  { value: 'rent_roll', label: 'Rent Roll', description: 'Active leases with tenant and unit details', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'profit_loss', label: 'P&L', description: 'Income, expenses, and NOI by property', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'vacancy', label: 'Vacancy', description: 'Vacant units and upcoming lease expirations', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'maintenance_cost', label: 'Maintenance', description: 'Work order costs by property and vendor', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { value: 'ar_aging', label: 'AR Aging', description: 'Outstanding balances by aging bucket', color: 'bg-red-50 text-red-700 border-red-200' },
  { value: 'owner_statement', label: 'Owner Statement', description: 'Owner P&L summary across properties', color: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
]

// ── Fetch Functions ──────────────────────────────────────────

async function fetchRentRoll(filters: ReportFilters): Promise<RentRollRow[]> {
  let query = supabase.from('view_rent_roll').select('*').order('property_name').order('unit_name')

  if (filters.propertyId && filters.propertyId !== 'all') {
    query = query.eq('property_id', filters.propertyId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []) as RentRollRow[]
}

async function fetchProfitLoss(filters: ReportFilters): Promise<ProfitLossRow[]> {
  // Use GL-based RPC with date range support
  const start = filters.dateFrom || `${new Date().getFullYear()}-01-01`
  const end = filters.dateTo || new Date().toISOString().split('T')[0]

  const { data, error } = await supabase.rpc('get_profit_and_loss', {
    p_start_date: start,
    p_end_date: end,
  })
  if (error) throw error

  let rows: ProfitLossRow[] = (data || []).map((row: any) => ({
    property_id: row.property_id,
    property_name: row.property_name,
    total_income: Number(row.total_income) || 0,
    total_expenses: Number(row.total_expenses) || 0,
    net_operating_income: Number(row.net_operating_income) || 0,
  }))

  if (filters.propertyId && filters.propertyId !== 'all') {
    rows = rows.filter(r => r.property_id === filters.propertyId)
  }

  return rows
    .filter(r => r.total_income > 0 || r.total_expenses > 0)
    .sort((a, b) => b.net_operating_income - a.net_operating_income)
}

async function fetchVacancy(filters: ReportFilters): Promise<VacancyRow[]> {
  const results: VacancyRow[] = []

  // 1. Vacant units
  let vacantQuery = supabase.from('units').select('id, name, property_id, properties ( name )').eq('status', 'Vacant')
  if (filters.propertyId && filters.propertyId !== 'all') {
    vacantQuery = vacantQuery.eq('property_id', filters.propertyId)
  }

  const { data: vacantUnits, error: vacantError } = await vacantQuery
  if (vacantError) throw vacantError
  for (const u of vacantUnits || []) {
    const prop = (u as any).properties
    results.push({
      unit_id: u.id,
      unit_name: u.name,
      property_id: u.property_id,
      property_name: prop?.name || 'Unknown',
      status: 'vacant',
      lease_end_date: null,
      tenant_name: null,
      days_until_expiry: null,
    })
  }

  // 2. Expiring leases (within dateTo days, default 60)
  const daysOut = filters.dateTo ? Math.ceil((new Date(filters.dateTo).getTime() - Date.now()) / 86400000) : 60
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() + Math.max(daysOut, 1))

  let expiringQuery = supabase
    .from('leases')
    .select('id, end_date, status, unit_id, units ( name, property_id, properties ( name ) ), tenants ( first_name, last_name )')
    .eq('status', 'Active')
    .not('end_date', 'is', null)
    .lte('end_date', cutoffDate.toISOString().split('T')[0])
    .gte('end_date', new Date().toISOString().split('T')[0])

  const { data: expiringLeases, error: expiringError } = await expiringQuery
  if (expiringError) throw expiringError
  for (const l of expiringLeases || []) {
    const unit = (l as any).units
    const prop = unit?.properties
    const tenant = (l as any).tenants

    if (filters.propertyId && filters.propertyId !== 'all' && unit?.property_id !== filters.propertyId) continue

    const daysLeft = l.end_date
      ? Math.ceil((new Date(l.end_date).getTime() - Date.now()) / 86400000)
      : null

    results.push({
      unit_id: unit?.id || l.unit_id,
      unit_name: unit?.name || 'Unknown',
      property_id: unit?.property_id || '',
      property_name: prop?.name || 'Unknown',
      status: 'expiring',
      lease_end_date: l.end_date,
      tenant_name: tenant ? `${tenant.first_name} ${tenant.last_name}` : null,
      days_until_expiry: daysLeft,
    })
  }

  return results.sort((a, b) => (a.days_until_expiry ?? 999) - (b.days_until_expiry ?? 999))
}

async function fetchMaintenanceCost(filters: ReportFilters): Promise<MaintenanceCostRow[]> {
  let query = supabase
    .from('work_orders')
    .select('id, title, cost, status, priority, created_at, units ( name, property_id, properties ( name ) ), vendors!vendor_id ( company_name )')
    .not('cost', 'is', null)
    .gt('cost', 0)
    .order('created_at', { ascending: false })

  if (filters.dateFrom) {
    query = query.gte('created_at', filters.dateFrom)
  }
  if (filters.dateTo) {
    query = query.lte('created_at', filters.dateTo + 'T23:59:59')
  }

  const { data, error } = await query
  if (error) throw error

  const rows: MaintenanceCostRow[] = []
  for (const wo of data || []) {
    const unit = (wo as any).units
    const prop = unit?.properties
    const vendor = (wo as any).vendors

    if (filters.propertyId && filters.propertyId !== 'all' && unit?.property_id !== filters.propertyId) continue

    rows.push({
      id: wo.id,
      title: wo.title,
      property_name: prop?.name || 'Unknown',
      unit_name: unit?.name || 'General',
      vendor_name: vendor?.company_name || null,
      cost: wo.cost || 0,
      status: wo.status,
      priority: wo.priority,
      created_at: wo.created_at,
    })
  }

  return rows
}

async function fetchARAging(filters: ReportFilters): Promise<ARAgingRow[]> {
  let query = supabase.from('view_ar_aging').select('*').order('balance_due', { ascending: false })

  if (filters.propertyId && filters.propertyId !== 'all') {
    query = query.eq('property_id', filters.propertyId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []) as ARAgingRow[]
}

async function fetchOwnerStatement(filters: ReportFilters): Promise<OwnerStatementRow[]> {
  let query = supabase.from('distribution_summary').select('*').order('owner_name').order('property_name')

  if (filters.ownerId && filters.ownerId !== 'all') {
    query = query.eq('owner_id', filters.ownerId)
  }

  const { data, error } = await query
  if (error) throw error
  return (data || []).map((r: any) => ({
    owner_id: r.owner_id,
    owner_name: r.owner_name || 'Unknown',
    property_id: r.property_id,
    property_name: r.property_name,
    total_income: r.total_income || 0,
    total_expenses: r.total_expenses || 0,
    net_balance: r.net_balance || 0,
  }))
}

// Router
async function fetchReport(filters: ReportFilters): Promise<ReportRow[]> {
  switch (filters.reportType) {
    case 'rent_roll': return fetchRentRoll(filters)
    case 'profit_loss': return fetchProfitLoss(filters)
    case 'vacancy': return fetchVacancy(filters)
    case 'maintenance_cost': return fetchMaintenanceCost(filters)
    case 'ar_aging': return fetchARAging(filters)
    case 'owner_statement': return fetchOwnerStatement(filters)
    default: return []
  }
}

// ── Hook ──────────────────────────────────────────────────

export function useReports(filters: ReportFilters) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['reports', filters.reportType, filters.propertyId, filters.dateFrom, filters.dateTo, filters.ownerId],
    queryFn: () => fetchReport(filters),
    enabled: !!filters.reportType,
  })

  // Property options for filter dropdown
  const { data: propertyOptions } = useQuery({
    queryKey: ['report-properties'],
    queryFn: async () => {
      const { data } = await supabase.from('properties').select('id, name').order('name')
      return data ?? []
    },
    staleTime: 5 * 60_000,
  })

  // Owner options for owner statement filter
  const { data: ownerOptions } = useQuery({
    queryKey: ['report-owners'],
    queryFn: async () => {
      const { data } = await supabase.from('owners').select('id, full_name').order('full_name')
      return data ?? []
    },
    enabled: filters.reportType === 'owner_statement',
    staleTime: 5 * 60_000,
  })

  return {
    data: (data ?? []) as ReportRow[],
    loading: isLoading,
    error,
    properties: propertyOptions ?? [],
    owners: ownerOptions ?? [],
  }
}

// ── Export Helpers ──────────────────────────────────────────

/** Download an array of objects as CSV */
export function downloadCSV(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) {
    toast.error('No data to export')
    return
  }

  const headers = Object.keys(rows[0])
  const csvLines = [
    headers.join(','),
    ...rows.map(row =>
      headers.map(h => {
        const val = row[h]
        if (val === null || val === undefined) return ''
        const str = String(val)
        // Escape quotes and wrap in quotes if contains comma, quote, or newline
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }).join(',')
    ),
  ]

  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toast.success(`Downloaded ${filename}.csv`)
}

/** Call the generate-report edge function and open the resulting PDF */
export async function exportReportPDF(reportType: ReportType, filters: ReportFilters) {
  const toastId = toast.loading('Generating PDF report...')

  try {
    const { data, error } = await supabase.functions.invoke('generate-report', {
      body: {
        report_type: reportType,
        filters: {
          propertyId: filters.propertyId !== 'all' ? filters.propertyId : undefined,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          ownerId: filters.ownerId !== 'all' ? filters.ownerId : undefined,
        },
      },
    })

    if (error) {
      let msg = error.message || 'Unknown error'
      if (error instanceof FunctionsHttpError) {
        const errBody = await error.context.json().catch(() => null)
        msg = errBody?.error || msg
      }
      throw new Error(msg)
    }

    const blob = data instanceof Blob ? data : new Blob([JSON.stringify(data)], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    // Revoke object URL after a delay to prevent memory leak
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    toast.success('PDF report generated', { id: toastId })
  } catch (err: any) {
    toast.error(err.message || 'Failed to generate PDF', { id: toastId })
  }
}

/** Format currency for display */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount)
}

/** Get a report type label */
export function getReportLabel(type: ReportType): string {
  return REPORT_TYPE_OPTIONS.find(o => o.value === type)?.label || type
}
