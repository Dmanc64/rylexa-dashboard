'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import {
  FileText, Download, Calendar, Search,
  Loader2, ArrowLeft, Building2, User, Filter
} from 'lucide-react'

type StatementRow = {
  id: string
  lease_id: string
  billing_month: number
  billing_year: number
  period_name: string
  opening_balance: number
  total_charges: number
  total_payments: number
  closing_balance: number
  pdf_path: string | null
  generated_at: string
  // joined
  tenant_id: string | null
  tenant_name: string
  unit_name: string
  property_name: string
}

type PropertyOption = { id: string; name: string }

const formatCurrency = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function AdminStatementsPage() {
  const [statements, setStatements] = useState<StatementRow[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [propertyFilter, setPropertyFilter] = useState('all')
  const [yearFilter, setYearFilter] = useState('all')
  const [properties, setProperties] = useState<PropertyOption[]>([])

  const fetchStatements = useCallback(async () => {
    setLoading(true)

    // Fetch all statements with lease → tenant + unit → property joins
    const { data, error } = await supabase
      .from('tenant_statements')
      .select(`
        *,
        leases!inner (
          id,
          tenants ( id, first_name, last_name ),
          units ( name, properties ( id, name ) )
        )
      `)
      .order('billing_year', { ascending: false })
      .order('billing_month', { ascending: false })

    if (error) {
      console.error('Failed to fetch statements:', error)
      setLoading(false)
      return
    }

    // Flatten the joined data
    const rows: StatementRow[] = (data || []).map((s: any) => {
      const lease = s.leases || {}
      const tenant = lease.tenants || {}
      const unit = lease.units || {}
      const property = unit.properties || {}
      return {
        id: s.id,
        lease_id: s.lease_id,
        billing_month: s.billing_month,
        billing_year: s.billing_year,
        period_name: s.period_name,
        opening_balance: s.opening_balance,
        total_charges: s.total_charges,
        total_payments: s.total_payments,
        closing_balance: s.closing_balance,
        pdf_path: s.pdf_path,
        generated_at: s.generated_at,
        tenant_id: tenant.id || null,
        tenant_name: `${tenant.first_name || ''} ${tenant.last_name || ''}`.trim() || 'Unknown',
        unit_name: unit.name || 'N/A',
        property_name: property.name || 'N/A',
      }
    })

    setStatements(rows)

    // Extract unique properties for filter
    const propMap = new Map<string, string>()
    rows.forEach(r => {
      const lease = (data || []).find((d: any) => d.id === r.id)
      const propId = lease?.leases?.units?.properties?.id
      if (propId && r.property_name !== 'N/A') {
        propMap.set(propId, r.property_name)
      }
    })
    setProperties(Array.from(propMap, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)))

    setLoading(false)
  }, [])

  useEffect(() => { fetchStatements() }, [fetchStatements])

  const handleDownload = async (stmt: StatementRow) => {
    if (!stmt.pdf_path) return
    setDownloading(stmt.id)
    try {
      const { data, error } = await supabase.storage
        .from('statements')
        .createSignedUrl(stmt.pdf_path, 60)
      if (error || !data?.signedUrl) throw new Error('Could not generate download link')
      window.open(data.signedUrl, '_blank')
    } catch (err) {
      console.error('Download failed:', err)
    } finally {
      setDownloading(null)
    }
  }

  // Extract unique years for filter
  const years = Array.from(new Set(statements.map(s => s.billing_year))).sort((a, b) => b - a)

  // Apply filters
  const filtered = statements.filter(s => {
    if (search) {
      const term = search.toLowerCase()
      const matchName = s.tenant_name.toLowerCase().includes(term)
      const matchUnit = s.unit_name.toLowerCase().includes(term)
      const matchProperty = s.property_name.toLowerCase().includes(term)
      const matchPeriod = `${s.period_name} ${s.billing_year}`.toLowerCase().includes(term)
      if (!matchName && !matchUnit && !matchProperty && !matchPeriod) return false
    }
    if (propertyFilter !== 'all' && s.property_name !== propertyFilter) return false
    if (yearFilter !== 'all' && s.billing_year !== Number(yearFilter)) return false
    return true
  })

  // Stats
  const totalOutstanding = filtered.reduce((sum, s) => sum + Math.max(s.closing_balance, 0), 0)
  const totalCollected = filtered.reduce((sum, s) => sum + s.total_payments, 0)

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900 animate-in fade-in">
      <div className="max-w-7xl mx-auto space-y-8">

        {/* HEADER */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
          <div>
            <Link href="/admin/finance" className="text-xs font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 mb-2 transition-colors">
              <ArrowLeft size={14} /> Back to Finance
            </Link>
            <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
              Tenant <span className="text-blue-600">Statements</span>
            </h1>
            <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
              All Generated Statements • {filtered.length} Records
            </p>
          </div>

          <div className="flex gap-3 items-center">
            <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-center shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Outstanding</p>
              <p className="text-lg font-black text-red-600">{formatCurrency(totalOutstanding)}</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl px-4 py-3 text-center shadow-sm">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Collected</p>
              <p className="text-lg font-black text-emerald-600">{formatCurrency(totalCollected)}</p>
            </div>
          </div>
        </div>

        {/* FILTERS */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by tenant, unit, property, or period..."
              className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium shadow-sm"
            />
          </div>
          <div className="flex gap-3">
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
              <select
                value={propertyFilter}
                onChange={(e) => setPropertyFilter(e.target.value)}
                className="pl-10 pr-6 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm appearance-none cursor-pointer"
              >
                <option value="all">All Properties</option>
                {properties.map(p => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
              <select
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                className="pl-10 pr-6 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-600 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm appearance-none cursor-pointer"
              >
                <option value="all">All Years</option>
                {years.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* TABLE */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="py-20 flex justify-center">
              <Loader2 className="animate-spin text-blue-600" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-20 text-center">
              <FileText size={40} className="mx-auto text-slate-200 mb-4" />
              <p className="text-slate-400 font-bold">No statements found.</p>
              <p className="text-slate-400 text-sm mt-1">Generate statements from individual tenant profiles.</p>
            </div>
          ) : (
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                <tr>
                  <th className="px-8 py-5">Tenant</th>
                  <th className="px-8 py-5">Property / Unit</th>
                  <th className="px-8 py-5">Period</th>
                  <th className="px-8 py-5">Charges</th>
                  <th className="px-8 py-5">Payments</th>
                  <th className="px-8 py-5">Balance</th>
                  <th className="px-8 py-5">Generated</th>
                  <th className="px-8 py-5 text-right">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((stmt) => (
                  <tr key={stmt.id} className="hover:bg-slate-50/50 transition-colors group">
                    <td className="px-8 py-5">
                      {stmt.tenant_id ? (
                        <Link
                          href={`/admin/tenants/${stmt.tenant_id}`}
                          className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors"
                        >
                          {stmt.tenant_name}
                        </Link>
                      ) : (
                        <span className="font-bold text-slate-900">{stmt.tenant_name}</span>
                      )}
                    </td>
                    <td className="px-8 py-5">
                      <div className="text-sm font-bold text-slate-600">{stmt.property_name}</div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase">Unit {stmt.unit_name}</div>
                    </td>
                    <td className="px-8 py-5">
                      <div className="font-bold text-slate-900">{stmt.period_name}</div>
                      <div className="text-[10px] text-slate-400 font-bold uppercase">{stmt.billing_year}</div>
                    </td>
                    <td className="px-8 py-5 font-mono text-sm font-bold text-amber-600">
                      {formatCurrency(stmt.total_charges)}
                    </td>
                    <td className="px-8 py-5 font-mono text-sm font-bold text-emerald-600">
                      {formatCurrency(stmt.total_payments)}
                    </td>
                    <td className="px-8 py-5">
                      <span className={`font-mono text-sm font-black ${stmt.closing_balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {formatCurrency(stmt.closing_balance)}
                      </span>
                    </td>
                    <td className="px-8 py-5 text-sm text-slate-500">
                      {new Date(stmt.generated_at).toLocaleDateString()}
                    </td>
                    <td className="px-8 py-5 text-right">
                      {stmt.pdf_path ? (
                        <button
                          onClick={() => handleDownload(stmt)}
                          disabled={downloading === stmt.id}
                          className="p-2 text-slate-300 hover:text-blue-600 transition-colors"
                          title="Download PDF"
                        >
                          {downloading === stmt.id ? (
                            <Loader2 size={18} className="animate-spin" />
                          ) : (
                            <Download size={18} />
                          )}
                        </button>
                      ) : (
                        <span className="text-slate-300 text-xs">No PDF</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* INFO NOTE */}
        <div className="p-6 bg-blue-50 border border-blue-100 rounded-2xl flex gap-4">
          <FileText className="text-blue-600 shrink-0" size={20} />
          <p className="text-xs text-blue-900 font-medium leading-relaxed">
            <strong>Tip:</strong> Generate new statements from individual tenant profiles under Residents → Tenant Detail → Generate Statement.
            Statements are stored in Supabase Storage and can be downloaded at any time.
          </p>
        </div>

      </div>
    </div>
  )
}
