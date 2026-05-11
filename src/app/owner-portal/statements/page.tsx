'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  FileText, Loader2, TrendingUp, TrendingDown,
  DollarSign, Building2, Download, FileBarChart, Calendar
} from 'lucide-react'
import { downloadCSV, exportReportPDF } from '@/hooks/useReports'

type PropertyStatement = {
  property_id: string
  property_name: string
  total_income: number
  total_expenses: number
  net_balance: number
}

type PeriodMode = 'month' | 'ytd' | 'year'

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

/** Compute [start, end] dates for a given period mode + optional year. */
function computeRange(mode: PeriodMode, year: number): { start: string; end: string; label: string } {
  const now = new Date()
  const currentYear = now.getFullYear()
  if (mode === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    const end   = now
    return {
      start: isoDate(start),
      end:   isoDate(end),
      label: now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    }
  }
  if (mode === 'ytd') {
    const start = new Date(currentYear, 0, 1)
    return {
      start: isoDate(start),
      end:   isoDate(now),
      label: `${currentYear} YTD`,
    }
  }
  // mode === 'year' — full calendar year (specific or current; if current, capped at today)
  const start = new Date(year, 0, 1)
  const yearEnd = new Date(year, 11, 31)
  const end = year === currentYear ? now : yearEnd
  return {
    start: isoDate(start),
    end:   isoDate(end),
    label: String(year),
  }
}

export default function OwnerStatementsPage() {
  const router = useRouter()
  const [statements, setStatements] = useState<PropertyStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [ownerId, setOwnerId] = useState<string | null>(null)

  // Period selection — defaults to current month
  const currentYear = new Date().getFullYear()
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month')
  const [yearChoice, setYearChoice] = useState<number>(currentYear)
  const range = useMemo(() => computeRange(periodMode, yearChoice), [periodMode, yearChoice])
  // Years available in the dropdown — current year and the four prior
  const yearOptions = useMemo(
    () => Array.from({ length: 5 }, (_, i) => currentYear - i),
    [currentYear]
  )

  useEffect(() => {
    async function fetchStatements() {
      setLoading(true)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Fetch all owner entities the user belongs to (multi-entity model)
      const { data: memberships } = await supabase
        .from('owner_entity_members')
        .select('owner_id')
        .eq('user_id', user.id)

      const ownerIds = (memberships ?? []).map((m: any) => m.owner_id)
      if (ownerIds.length === 0) { setLoading(false); return }

      // For PDF export, pass the first entity (multi-entity export TBD).
      setOwnerId(ownerIds[0])

      // Use the new RPC that takes a date range + scopes by user_property_ids()
      const { data } = await supabase.rpc('get_property_pnl_by_period', {
        p_start: range.start,
        p_end:   range.end,
      })

      setStatements((data ?? []).map((row: any) => ({
        property_id:    row.property_id,
        property_name:  row.property_name,
        total_income:   Number(row.total_income) || 0,
        total_expenses: Number(row.total_expenses) || 0,
        net_balance:    Number(row.net_balance) || 0,
      })))
      setLoading(false)
    }
    fetchStatements()
  }, [router, range.start, range.end])

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-emerald-500" size={40} />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Loading Statements...</p>
      </div>
    )
  }

  const totals = statements.reduce(
    (acc, s) => ({
      income: acc.income + s.total_income,
      expenses: acc.expenses + s.total_expenses,
      net: acc.net + s.net_balance,
    }),
    { income: 0, expenses: 0, net: 0 }
  )

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">

      {/* HEADER */}
      <div className="max-w-6xl mx-auto mb-10">
        <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase mb-2">Owner Portal</p>
        <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
          Financial <span className="text-emerald-600">Statements</span>
        </h1>
        <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
          Profit &amp; Loss by Property &bull; {range.label}
        </p>
      </div>

      {/* PERIOD SELECTOR */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <Calendar size={12} /> Period
          </span>
          {(['month', 'ytd', 'year'] as PeriodMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setPeriodMode(mode)}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors ${
                periodMode === mode
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100'
              }`}
            >
              {mode === 'month' ? 'This Month' : mode === 'ytd' ? 'Year to Date' : 'Specific Year'}
            </button>
          ))}
          {periodMode === 'year' && (
            <select
              value={yearChoice}
              onChange={(e) => setYearChoice(Number(e.target.value))}
              className="ml-2 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider bg-slate-50 text-slate-700 border-0 focus:ring-2 focus:ring-emerald-500/20"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          )}
          <span className="ml-auto text-[10px] font-bold text-slate-400">
            {range.start} &rarr; {range.end}
          </span>
        </div>
      </div>

      {/* TOTALS ROW */}
      <div className="max-w-6xl mx-auto grid grid-cols-3 gap-6 mb-10">
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp size={16} className="text-emerald-500" />
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Income</p>
          </div>
          <p className="text-3xl font-black italic tracking-tighter text-emerald-600">
            ${totals.income.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown size={16} className="text-red-500" />
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Expenses</p>
          </div>
          <p className="text-3xl font-black italic tracking-tighter text-red-500">
            ${totals.expenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="bg-slate-900 rounded-[2rem] p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign size={16} className="text-emerald-400" />
            <p className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Net Operating Income</p>
          </div>
          <p className={`text-3xl font-black italic tracking-tighter ${totals.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            ${totals.net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </div>

      {/* PER-PROPERTY TABLE */}
      {statements.length === 0 ? (
        <div className="max-w-6xl mx-auto py-20 text-center">
          <FileText size={48} className="text-slate-300 mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">No financial data available</p>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5">Property</th>
                <th className="px-8 py-5 text-right">Income</th>
                <th className="px-8 py-5 text-right">Expenses</th>
                <th className="px-8 py-5 text-right">NOI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {statements.map((s) => (
                <tr key={s.property_id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <Building2 size={16} className="text-slate-300" />
                      <span className="text-sm font-black text-slate-900 italic uppercase">{s.property_name}</span>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-right text-sm font-bold text-emerald-600">
                    ${s.total_income.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-8 py-5 text-right text-sm font-bold text-red-500">
                    ${s.total_expenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-8 py-5 text-right">
                    <span className={`text-sm font-black ${s.net_balance >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                      ${s.net_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 border-t border-slate-200">
              <tr>
                <td className="px-8 py-5 text-xs font-black text-slate-900 uppercase">Portfolio Total</td>
                <td className="px-8 py-5 text-right text-sm font-black text-emerald-600">${totals.income.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-8 py-5 text-right text-sm font-black text-red-500">${totals.expenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-8 py-5 text-right text-sm font-black text-slate-900">${totals.net.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* EXPORT SECTION */}
      {statements.length > 0 && (
        <div className="max-w-6xl mx-auto mt-8 bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-4">
            <FileBarChart size={18} className="text-emerald-500" />
            <h3 className="text-xs font-black uppercase tracking-widest text-slate-900">Download Reports</h3>
          </div>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-6">
            Export your financial statements as CSV or PDF
          </p>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => {
                const csvRows = statements.map(s => ({
                  property_name: s.property_name,
                  total_income: s.total_income,
                  total_expenses: s.total_expenses,
                  net_balance: s.net_balance,
                }))
                downloadCSV(csvRows, `Owner_Statement_${new Date().toISOString().split('T')[0]}`)
              }}
              className="flex items-center gap-2 px-6 py-3 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 transition-all"
            >
              <Download size={14} />
              Export CSV
            </button>
            <button
              onClick={() => {
                if (!ownerId) return
                exportReportPDF('owner_statement', {
                  reportType: 'owner_statement',
                  ownerId,
                })
              }}
              className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-slate-800 transition-all"
            >
              <FileBarChart size={14} />
              Generate PDF
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
