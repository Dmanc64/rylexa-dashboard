'use client'

import React, { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  FileBarChart, Download, FileText, Loader2, AlertCircle,
  Building2, Calendar, Users2, TrendingUp, TrendingDown,
  Home, DollarSign, Clock, Wrench, AlertTriangle, CalendarClock
} from 'lucide-react'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useReports,
  downloadCSV,
  exportReportPDF,
  formatCurrency,
  getReportLabel,
  REPORT_TYPE_OPTIONS,
  type ReportType,
  type ReportFilters,
  type RentRollRow,
  type ProfitLossRow,
  type VacancyRow,
  type MaintenanceCostRow,
  type ARAgingRow,
  type OwnerStatementRow,
} from '@/hooks/useReports'

const VALID_REPORT_TYPES: ReportType[] = ['rent_roll', 'profit_loss', 'vacancy', 'maintenance_cost', 'ar_aging', 'owner_statement']

export default function AdminReportsPage() {
  const { isEnabled, loading: flagsLoading } = useFeatureFlags()
  const searchParams = useSearchParams()

  const [reportType, setReportType] = useState<ReportType>('rent_roll')

  // Auto-select report type from URL query param (e.g. ?report=ar_aging)
  useEffect(() => {
    const param = searchParams.get('report') as ReportType | null
    if (param && VALID_REPORT_TYPES.includes(param)) {
      setReportType(param)
    }
  }, [searchParams])
  const [propertyId, setPropertyId] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [ownerId, setOwnerId] = useState('all')
  const [generatingPDF, setGeneratingPDF] = useState(false)

  const filters: ReportFilters = {
    reportType,
    propertyId: propertyId !== 'all' ? propertyId : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    ownerId: ownerId !== 'all' ? ownerId : undefined,
  }

  const { data, loading, properties, owners } = useReports(filters)

  const handleExportCSV = () => {
    const filename = `${reportType}_${new Date().toISOString().split('T')[0]}`
    downloadCSV(data, filename)
  }

  const handleExportPDF = async () => {
    setGeneratingPDF(true)
    await exportReportPDF(reportType, filters)
    setGeneratingPDF(false)
  }

  // Needs date filter?
  const needsDateFilter = ['profit_loss', 'maintenance_cost', 'vacancy'].includes(reportType)
  // Needs owner filter?
  const needsOwnerFilter = reportType === 'owner_statement'

  // Feature flag
  if (flagsLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    )
  }

  if (!isEnabled('reports')) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <AlertCircle size={48} className="text-slate-300" />
        <p className="text-slate-400 font-bold text-sm">Reporting & Exports is currently disabled.</p>
        <p className="text-slate-400 text-xs">Enable the &quot;reports&quot; feature flag in Settings.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">
      <div className="max-w-[1400px] mx-auto">

        {/* HEADER */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase mb-2">Analytics & Exports</p>
            <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
              Report <span className="text-emerald-600">Center</span>
            </h1>
            <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
              {data.length} Record{data.length !== 1 ? 's' : ''} &bull; {getReportLabel(reportType)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isEnabled('scheduled_reports') && (
              <Link
                href="/admin/reports/schedules"
                className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm"
              >
                <CalendarClock size={16} />
                Schedules
              </Link>
            )}
            <button
              onClick={handleExportCSV}
              disabled={data.length === 0 || loading}
              className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-40"
            >
              <Download size={16} />
              CSV
            </button>
            <button
              onClick={handleExportPDF}
              disabled={data.length === 0 || loading || generatingPDF}
              className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-blue-600 transition-all shadow-lg active:scale-95 disabled:opacity-40"
            >
              {generatingPDF ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
              PDF
            </button>
          </div>
        </div>

        {/* REPORT TYPE SELECTOR */}
        <div className="flex gap-2 bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm mb-6 overflow-x-auto">
          {REPORT_TYPE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setReportType(opt.value); setPropertyId('all'); setOwnerId('all'); setDateFrom(''); setDateTo('') }}
              className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider whitespace-nowrap transition-all ${
                reportType === opt.value
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* FILTERS */}
        <div className="flex flex-wrap items-end gap-4 mb-6">
          {/* Property filter (always shown) */}
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Property</label>
            <div className="relative">
              <Building2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
                className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 appearance-none min-w-[200px]"
              >
                <option value="all">All Properties</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Date range (conditional) */}
          {needsDateFilter && (
            <>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">From</label>
                <div className="relative">
                  <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={e => setDateFrom(e.target.value)}
                    className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">To</label>
                <div className="relative">
                  <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="date"
                    value={dateTo}
                    onChange={e => setDateTo(e.target.value)}
                    className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  />
                </div>
              </div>
            </>
          )}

          {/* Owner filter (conditional) */}
          {needsOwnerFilter && (
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">Owner</label>
              <div className="relative">
                <Users2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select
                  value={ownerId}
                  onChange={e => setOwnerId(e.target.value)}
                  className="pl-9 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 appearance-none min-w-[200px]"
                >
                  <option value="all">All Owners</option>
                  {owners.map((o: any) => (
                    <option key={o.id} value={o.id}>{o.full_name}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        {/* KPI CARDS */}
        {!loading && data.length > 0 && <KPICards reportType={reportType} data={data} />}

        {/* DATA TABLE */}
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-20 text-center">
              <Loader2 size={32} className="animate-spin mx-auto text-blue-500 mb-3" />
              <p className="text-slate-400 font-bold text-sm">Loading report...</p>
            </div>
          ) : data.length === 0 ? (
            <div className="p-20 text-center">
              <FileBarChart size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-400 font-bold text-sm">No data found</p>
              <p className="text-slate-400 text-xs mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <ReportTable reportType={reportType} data={data} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── KPI Cards Component ──
function KPICards({ reportType, data }: { reportType: ReportType; data: any[] }) {
  switch (reportType) {
    case 'rent_roll': {
      const rows = data as RentRollRow[]
      const totalRent = rows.reduce((s, r) => s + (r.rent_amount || 0), 0)
      const avgRent = rows.length ? totalRent / rows.length : 0
      return (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <KPICard icon={Home} label="Active Leases" value={rows.length.toString()} color="blue" />
          <KPICard icon={DollarSign} label="Total Monthly Rent" value={formatCurrency(totalRent)} color="emerald" />
          <KPICard icon={TrendingUp} label="Average Rent" value={formatCurrency(avgRent)} color="violet" />
        </div>
      )
    }
    case 'profit_loss': {
      const rows = data as ProfitLossRow[]
      const totalIncome = rows.reduce((s, r) => s + r.total_income, 0)
      const totalExpenses = rows.reduce((s, r) => s + r.total_expenses, 0)
      const noi = totalIncome - totalExpenses
      return (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <KPICard icon={TrendingUp} label="Total Income" value={formatCurrency(totalIncome)} color="emerald" />
          <KPICard icon={TrendingDown} label="Total Expenses" value={formatCurrency(totalExpenses)} color="red" />
          <KPICard icon={DollarSign} label="Net Operating Income" value={formatCurrency(noi)} color="blue" />
        </div>
      )
    }
    case 'vacancy': {
      const rows = data as VacancyRow[]
      const vacant = rows.filter(r => r.status === 'vacant').length
      const expiring30 = rows.filter(r => r.status === 'expiring' && (r.days_until_expiry ?? 999) <= 30).length
      const expiring60 = rows.filter(r => r.status === 'expiring' && (r.days_until_expiry ?? 999) <= 60).length
      return (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <KPICard icon={Home} label="Vacant Units" value={vacant.toString()} color="red" />
          <KPICard icon={Clock} label="Expiring in 30d" value={expiring30.toString()} color="amber" />
          <KPICard icon={AlertTriangle} label="Expiring in 60d" value={expiring60.toString()} color="orange" />
        </div>
      )
    }
    case 'maintenance_cost': {
      const rows = data as MaintenanceCostRow[]
      const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0)
      const avgCost = rows.length ? totalCost / rows.length : 0
      return (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <KPICard icon={Wrench} label="Work Orders" value={rows.length.toString()} color="orange" />
          <KPICard icon={DollarSign} label="Total Cost" value={formatCurrency(totalCost)} color="red" />
          <KPICard icon={TrendingDown} label="Avg Cost / WO" value={formatCurrency(avgCost)} color="amber" />
        </div>
      )
    }
    case 'ar_aging': {
      const rows = data as ARAgingRow[]
      const totalOutstanding = rows.reduce((s, r) => s + Math.max(r.balance_due, 0), 0)
      const bucket30 = rows.filter(r => r.aging_bucket === '0-30').reduce((s, r) => s + r.balance_due, 0)
      const bucket90 = rows.filter(r => r.aging_bucket === '90+').reduce((s, r) => s + r.balance_due, 0)
      return (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <KPICard icon={DollarSign} label="Total Outstanding" value={formatCurrency(totalOutstanding)} color="red" />
          <KPICard icon={Clock} label="0-30 Days" value={formatCurrency(bucket30)} color="amber" />
          <KPICard icon={AlertTriangle} label="90+ Days" value={formatCurrency(bucket90)} color="red" />
        </div>
      )
    }
    case 'owner_statement': {
      const rows = data as OwnerStatementRow[]
      const totalIncome = rows.reduce((s, r) => s + r.total_income, 0)
      const totalExpenses = rows.reduce((s, r) => s + r.total_expenses, 0)
      const netBalance = rows.reduce((s, r) => s + r.net_balance, 0)
      return (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <KPICard icon={TrendingUp} label="Total Income" value={formatCurrency(totalIncome)} color="emerald" />
          <KPICard icon={TrendingDown} label="Total Expenses" value={formatCurrency(totalExpenses)} color="red" />
          <KPICard icon={DollarSign} label="Net to Owners" value={formatCurrency(netBalance)} color="blue" />
        </div>
      )
    }
    default: return null
  }
}

function KPICard({ icon: Icon, label, value, color }: { icon: any; label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    violet: 'bg-violet-50 text-violet-600',
    red: 'bg-red-50 text-red-600',
    amber: 'bg-amber-50 text-amber-600',
    orange: 'bg-orange-50 text-orange-600',
  }
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 ${colorMap[color] || colorMap.blue} rounded-xl flex items-center justify-center`}>
          <Icon size={18} />
        </div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{label}</span>
      </div>
      <p className="text-2xl font-black text-slate-900 tracking-tight">{value}</p>
    </div>
  )
}

// ── Report Table Component ──
function ReportTable({ reportType, data }: { reportType: ReportType; data: any[] }) {
  const thClass = 'px-6 py-4 text-left text-[10px] font-black uppercase tracking-widest text-slate-400 bg-slate-50'
  const tdClass = 'px-6 py-4 text-sm font-medium text-slate-700'

  switch (reportType) {
    case 'rent_roll': {
      const rows = data as RentRollRow[]
      return (
        <table className="w-full">
          <thead><tr>
            <th className={thClass}>Property</th>
            <th className={thClass}>Unit</th>
            <th className={thClass}>Tenant</th>
            <th className={thClass}>Email</th>
            <th className={thClass}>Rent</th>
            <th className={thClass}>Start</th>
            <th className={thClass}>End</th>
            <th className={thClass}>Status</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.lease_id} className="hover:bg-slate-50/50 transition-colors">
                <td className={tdClass}>{r.property_name}</td>
                <td className={tdClass}>{r.unit_name}</td>
                <td className={`${tdClass} font-bold text-slate-900`}>{r.first_name} {r.last_name}</td>
                <td className={`${tdClass} text-slate-500`}>{r.tenant_email}</td>
                <td className={`${tdClass} font-bold`}>{formatCurrency(r.rent_amount)}</td>
                <td className={`${tdClass} text-slate-500`}>{r.start_date ? new Date(r.start_date).toLocaleDateString() : '—'}</td>
                <td className={`${tdClass} text-slate-500`}>{r.end_date ? new Date(r.end_date).toLocaleDateString() : 'MTM'}</td>
                <td className={tdClass}>
                  <span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {r.lease_status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    case 'profit_loss': {
      const rows = data as ProfitLossRow[]
      const totalIncome = rows.reduce((s, r) => s + r.total_income, 0)
      const totalExpenses = rows.reduce((s, r) => s + r.total_expenses, 0)
      const totalNOI = totalIncome - totalExpenses
      return (
        <table className="w-full">
          <thead><tr>
            <th className={thClass}>Property</th>
            <th className={`${thClass} text-right`}>Income</th>
            <th className={`${thClass} text-right`}>Expenses</th>
            <th className={`${thClass} text-right`}>NOI</th>
            <th className={`${thClass} text-right`}>Margin</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => {
              const margin = r.total_income > 0 ? (r.net_operating_income / r.total_income * 100) : 0
              return (
                <tr key={r.property_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className={`${tdClass} font-bold text-slate-900`}>{r.property_name}</td>
                  <td className={`${tdClass} text-right text-emerald-700 font-bold`}>{formatCurrency(r.total_income)}</td>
                  <td className={`${tdClass} text-right text-red-600 font-bold`}>{formatCurrency(r.total_expenses)}</td>
                  <td className={`${tdClass} text-right font-black text-slate-900`}>{formatCurrency(r.net_operating_income)}</td>
                  <td className={`${tdClass} text-right`}>{margin.toFixed(1)}%</td>
                </tr>
              )
            })}
            <tr className="bg-slate-50 font-black">
              <td className={`${tdClass} text-slate-900`}>TOTALS</td>
              <td className={`${tdClass} text-right text-emerald-700`}>{formatCurrency(totalIncome)}</td>
              <td className={`${tdClass} text-right text-red-600`}>{formatCurrency(totalExpenses)}</td>
              <td className={`${tdClass} text-right text-slate-900`}>{formatCurrency(totalNOI)}</td>
              <td className={`${tdClass} text-right`}>{totalIncome > 0 ? (totalNOI / totalIncome * 100).toFixed(1) : '0.0'}%</td>
            </tr>
          </tbody>
        </table>
      )
    }

    case 'vacancy': {
      const rows = data as VacancyRow[]
      return (
        <table className="w-full">
          <thead><tr>
            <th className={thClass}>Property</th>
            <th className={thClass}>Unit</th>
            <th className={thClass}>Status</th>
            <th className={thClass}>Tenant</th>
            <th className={thClass}>Lease End</th>
            <th className={thClass}>Days Left</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => (
              <tr key={`${r.unit_id}-${i}`} className="hover:bg-slate-50/50 transition-colors">
                <td className={tdClass}>{r.property_name}</td>
                <td className={`${tdClass} font-bold text-slate-900`}>{r.unit_name}</td>
                <td className={tdClass}>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase border ${
                    r.status === 'vacant'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}>
                    {r.status === 'vacant' ? 'Vacant' : 'Expiring'}
                  </span>
                </td>
                <td className={`${tdClass} text-slate-500`}>{r.tenant_name || '—'}</td>
                <td className={`${tdClass} text-slate-500`}>{r.lease_end_date ? new Date(r.lease_end_date).toLocaleDateString() : '—'}</td>
                <td className={tdClass}>
                  {r.days_until_expiry !== null ? (
                    <span className={`font-bold ${r.days_until_expiry <= 30 ? 'text-red-600' : 'text-amber-600'}`}>
                      {r.days_until_expiry}d
                    </span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    case 'maintenance_cost': {
      const rows = data as MaintenanceCostRow[]
      const totalCost = rows.reduce((s, r) => s + (r.cost || 0), 0)
      return (
        <table className="w-full">
          <thead><tr>
            <th className={thClass}>Date</th>
            <th className={thClass}>Property</th>
            <th className={thClass}>Unit</th>
            <th className={thClass}>Work Order</th>
            <th className={thClass}>Vendor</th>
            <th className={thClass}>Priority</th>
            <th className={`${thClass} text-right`}>Cost</th>
            <th className={thClass}>Status</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-slate-50/50 transition-colors">
                <td className={`${tdClass} text-slate-500`}>{new Date(r.created_at).toLocaleDateString()}</td>
                <td className={tdClass}>{r.property_name}</td>
                <td className={tdClass}>{r.unit_name}</td>
                <td className={`${tdClass} font-bold text-slate-900`}>{r.title}</td>
                <td className={`${tdClass} text-slate-500`}>{r.vendor_name || '—'}</td>
                <td className={tdClass}>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase border ${
                    r.priority === 'Emergency' ? 'bg-red-50 text-red-700 border-red-200'
                    : r.priority === 'High' ? 'bg-orange-50 text-orange-700 border-orange-200'
                    : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}>
                    {r.priority}
                  </span>
                </td>
                <td className={`${tdClass} text-right font-bold`}>{formatCurrency(r.cost)}</td>
                <td className={tdClass}>
                  <span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-slate-50 text-slate-600 border border-slate-200">
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            <tr className="bg-slate-50 font-black">
              <td className={tdClass} colSpan={6}>TOTAL</td>
              <td className={`${tdClass} text-right`}>{formatCurrency(totalCost)}</td>
              <td className={tdClass}></td>
            </tr>
          </tbody>
        </table>
      )
    }

    case 'ar_aging': {
      const rows = data as ARAgingRow[]
      const bucketColors: Record<string, string> = {
        'current': 'bg-emerald-50 text-emerald-700 border-emerald-200',
        '0-30': 'bg-blue-50 text-blue-700 border-blue-200',
        '31-60': 'bg-amber-50 text-amber-700 border-amber-200',
        '61-90': 'bg-orange-50 text-orange-700 border-orange-200',
        '90+': 'bg-red-50 text-red-700 border-red-200',
      }
      return (
        <table className="w-full">
          <thead><tr>
            <th className={thClass}>Tenant</th>
            <th className={thClass}>Property</th>
            <th className={thClass}>Unit</th>
            <th className={`${thClass} text-right`}>Rent</th>
            <th className={`${thClass} text-right`}>Charges</th>
            <th className={`${thClass} text-right`}>Payments</th>
            <th className={`${thClass} text-right`}>Balance</th>
            <th className={thClass}>Aging</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.filter(r => r.balance_due > 0).map(r => (
              <tr key={r.lease_id} className="hover:bg-slate-50/50 transition-colors">
                <td className={`${tdClass} font-bold text-slate-900`}>{r.first_name} {r.last_name}</td>
                <td className={tdClass}>{r.property_name}</td>
                <td className={tdClass}>{r.unit_name}</td>
                <td className={`${tdClass} text-right text-slate-500`}>{formatCurrency(r.rent_amount)}</td>
                <td className={`${tdClass} text-right text-slate-500`}>{formatCurrency(r.total_charges)}</td>
                <td className={`${tdClass} text-right text-slate-500`}>{formatCurrency(r.total_payments)}</td>
                <td className={`${tdClass} text-right font-black text-red-600`}>{formatCurrency(r.balance_due)}</td>
                <td className={tdClass}>
                  <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase border ${bucketColors[r.aging_bucket] || bucketColors['current']}`}>
                    {r.aging_bucket}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }

    case 'owner_statement': {
      const rows = data as OwnerStatementRow[]
      // Group by owner
      const ownerGroups = new Map<string, OwnerStatementRow[]>()
      for (const r of rows) {
        const list = ownerGroups.get(r.owner_id) || []
        list.push(r)
        ownerGroups.set(r.owner_id, list)
      }
      return (
        <table className="w-full">
          <thead><tr>
            <th className={thClass}>Owner</th>
            <th className={thClass}>Property</th>
            <th className={`${thClass} text-right`}>Income</th>
            <th className={`${thClass} text-right`}>Expenses</th>
            <th className={`${thClass} text-right`}>Net</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {Array.from(ownerGroups.entries()).map(([ownerId, ownerRows]) => {
              const ownerIncome = ownerRows.reduce((s, r) => s + r.total_income, 0)
              const ownerExpenses = ownerRows.reduce((s, r) => s + r.total_expenses, 0)
              const ownerNet = ownerRows.reduce((s, r) => s + r.net_balance, 0)
              return (
                <React.Fragment key={ownerId}>
                  {ownerRows.map((r, i) => (
                    <tr key={`${r.owner_id}-${r.property_id}`} className="hover:bg-slate-50/50 transition-colors">
                      <td className={`${tdClass} ${i === 0 ? 'font-black text-slate-900' : 'text-transparent'}`}>
                        {r.owner_name}
                      </td>
                      <td className={tdClass}>{r.property_name}</td>
                      <td className={`${tdClass} text-right text-emerald-700 font-bold`}>{formatCurrency(r.total_income)}</td>
                      <td className={`${tdClass} text-right text-red-600 font-bold`}>{formatCurrency(r.total_expenses)}</td>
                      <td className={`${tdClass} text-right font-black`}>{formatCurrency(r.net_balance)}</td>
                    </tr>
                  ))}
                  {ownerRows.length > 1 && (
                    <tr className="bg-slate-50/50">
                      <td className={`${tdClass} text-[10px] font-black uppercase text-slate-400`} colSpan={2}>
                        Subtotal — {ownerRows[0].owner_name}
                      </td>
                      <td className={`${tdClass} text-right text-emerald-700 font-black`}>{formatCurrency(ownerIncome)}</td>
                      <td className={`${tdClass} text-right text-red-600 font-black`}>{formatCurrency(ownerExpenses)}</td>
                      <td className={`${tdClass} text-right font-black`}>{formatCurrency(ownerNet)}</td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      )
    }

    default:
      return <div className="p-10 text-center text-slate-400">Select a report type</div>
  }
}
