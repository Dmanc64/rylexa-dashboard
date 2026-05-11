'use client'

import { useState, useMemo, useCallback, useEffect } from 'react'
import {
  BarChart3, Loader2, Plus, Copy, CheckCircle2, Lock, LockOpen,
  TrendingUp, DollarSign, Percent, AlertTriangle, Trash2,
  CalendarClock, ShieldCheck, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, ComposedChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { toast } from 'sonner'
import AccessibleModal from '@/components/AccessibleModal'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useBudgetProperties,
  useBudgetList,
  useBudgetDetail,
  useBudgetVsActual,
  useForecast,
  useMonthlyActuals,
  useBudgetMutations,
  lineItemAnnualTotal,
  MONTH_KEYS,
  MONTH_LABELS,
  type Budget,
  type BudgetLineItem,
  type BudgetVsActualRow,
  type ForecastMonth,
  type BudgetStatus,
} from '@/hooks/useBudgets'
import { supabase } from '@/lib/supabaseClient'

// ── Constants ──

type TabKey = 'dashboard' | 'editor' | 'bva' | 'forecast'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'editor', label: 'Budget Editor' },
  { key: 'bva', label: 'Budget vs. Actual' },
  { key: 'forecast', label: 'Forecast' },
]

type PeriodKey = 'mtd' | 'qtd' | 'ytd' | 'full'
const CURRENT_MONTH = new Date().getMonth() + 1
const CURRENT_YEAR = new Date().getFullYear()
const QUARTER_START = [1, 1, 1, 4, 4, 4, 7, 7, 7, 10, 10, 10][CURRENT_MONTH - 1]

function periodRange(period: PeriodKey): [number, number] {
  switch (period) {
    case 'mtd': return [CURRENT_MONTH, CURRENT_MONTH]
    case 'qtd': return [QUARTER_START, CURRENT_MONTH]
    case 'ytd': return [1, CURRENT_MONTH]
    case 'full': return [1, 12]
  }
}

const currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const pctFmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

// ── Page ──

export default function BudgetsPage() {
  const { isEnabled, loading: flagsLoading } = useFeatureFlags()

  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')
  const [selectedPropId, setSelectedPropId] = useState('')
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)

  // Properties for dropdown
  const { data: properties } = useBudgetProperties()
  const propList = properties ?? []

  // Budget for selected property/year
  const { data: budgets } = useBudgetList(selectedPropId || undefined, selectedYear)
  const activeBudget = budgets?.[0] ?? null

  if (flagsLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    )
  }

  if (!isEnabled('budgeting')) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <BarChart3 size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-bold text-slate-600">Budgeting Module Disabled</h2>
          <p className="text-sm text-slate-400 mt-2">Enable the &quot;budgeting&quot; feature flag in Settings.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">
      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
          <div>
            <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
              Budget <span className="text-violet-600">&amp; Forecast</span>
            </h1>
            <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
              Annual operating budgets • Variance analysis • Revenue forecasting
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            <select
              value={selectedPropId}
              onChange={(e) => setSelectedPropId(e.target.value)}
              className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold bg-white shadow-sm"
            >
              <option value="">Select Property…</option>
              {propList.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>

            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(Number(e.target.value))}
              className="border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-bold bg-white shadow-sm"
            >
              {[CURRENT_YEAR + 1, CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mt-6">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeTab === t.key
                  ? 'bg-violet-600 text-white shadow-md'
                  : 'bg-white text-slate-400 border border-slate-200 hover:text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* No property selected */}
      {!selectedPropId && (
        <div className="max-w-7xl mx-auto bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-16 text-center">
          <BarChart3 size={48} className="mx-auto text-slate-200 mb-4" />
          <p className="text-slate-400 font-bold">Select a property to get started</p>
        </div>
      )}

      {/* Tab content */}
      {selectedPropId && activeTab === 'dashboard' && (
        <DashboardTab
          propertyId={selectedPropId}
          fiscalYear={selectedYear}
          budget={activeBudget}
        />
      )}
      {selectedPropId && activeTab === 'editor' && (
        <EditorTab
          propertyId={selectedPropId}
          fiscalYear={selectedYear}
          budget={activeBudget}
          propertyName={propList.find((p) => p.id === selectedPropId)?.name ?? ''}
        />
      )}
      {selectedPropId && activeTab === 'bva' && (
        <BvaTab
          propertyId={selectedPropId}
          fiscalYear={selectedYear}
        />
      )}
      {selectedPropId && activeTab === 'forecast' && (
        <ForecastTab
          propertyId={selectedPropId}
          fiscalYear={selectedYear}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 1: Dashboard
// ═══════════════════════════════════════════════════

function DashboardTab({
  propertyId,
  fiscalYear,
  budget,
}: {
  propertyId: string
  fiscalYear: number
  budget: Budget | null
}) {
  const { data: detail } = useBudgetDetail(budget?.id ?? null)
  const { data: bvaRows } = useBudgetVsActual(propertyId, fiscalYear, 1, CURRENT_MONTH)
  const { data: forecastData } = useForecast(propertyId, fiscalYear, 5)
  const { data: monthlyActuals } = useMonthlyActuals(propertyId, fiscalYear)

  const lineItems = detail?.lineItems ?? []

  // KPI calculations
  const totalBudget = lineItems
    .filter((li) => li.line_type === 'Income')
    .reduce((sum, li) => sum + lineItemAnnualTotal(li), 0)
  const totalBudgetExp = lineItems
    .filter((li) => li.line_type === 'Expense')
    .reduce((sum, li) => sum + lineItemAnnualTotal(li), 0)

  const spentYTD = (bvaRows ?? [])
    .filter((r) => r.line_type === 'Expense')
    .reduce((sum, r) => sum + r.actual_amount, 0)
  const earnedYTD = (bvaRows ?? [])
    .filter((r) => r.line_type === 'Income')
    .reduce((sum, r) => sum + r.actual_amount, 0)

  const remaining = totalBudgetExp - spentYTD
  const pctUsed = totalBudgetExp > 0 ? (spentYTD / totalBudgetExp) * 100 : 0

  // Chart data: budget vs actual by month
  const chartData = useMemo(() => {
    const actMap = new Map<number, { income: number; expense: number }>()
    ;(monthlyActuals ?? []).forEach((a) => {
      const existing = actMap.get(a.month_num) ?? { income: 0, expense: 0 }
      if (a.line_type === 'Income') existing.income += a.actual_amount
      else existing.expense += a.actual_amount
      actMap.set(a.month_num, existing)
    })

    return MONTH_LABELS.map((label, i) => {
      const mIdx = i + 1
      const budgetIncome = lineItems
        .filter((li) => li.line_type === 'Income')
        .reduce((s, li) => s + (Number(li[MONTH_KEYS[i]]) || 0), 0)
      const budgetExpense = lineItems
        .filter((li) => li.line_type === 'Expense')
        .reduce((s, li) => s + (Number(li[MONTH_KEYS[i]]) || 0), 0)
      const act = actMap.get(mIdx) ?? { income: 0, expense: 0 }
      const fc = (forecastData ?? []).find((f) => f.month_num === mIdx)

      return {
        month: label,
        budgetNOI: budgetIncome - budgetExpense,
        actualNOI: mIdx <= CURRENT_MONTH ? act.income - act.expense : undefined,
        forecastNOI: fc ? fc.projected_noi : undefined,
      }
    })
  }, [lineItems, monthlyActuals, forecastData])

  // Top variances
  const topVariances = useMemo(() => {
    return (bvaRows ?? [])
      .filter((r) => r.budget_amount > 0 || r.actual_amount > 0)
      .sort((a, b) => Math.abs(b.variance_dollars) - Math.abs(a.variance_dollars))
      .slice(0, 5)
  }, [bvaRows])

  if (!budget) {
    return (
      <div className="max-w-7xl mx-auto bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-16 text-center">
        <BarChart3 size={48} className="mx-auto text-slate-200 mb-4" />
        <p className="text-lg font-bold text-slate-500 mb-2">No budget for {fiscalYear}</p>
        <p className="text-sm text-slate-400">Switch to the Budget Editor tab to create one.</p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard label="Total Budget (Income)" value={currencyFmt.format(totalBudget)} icon={<DollarSign size={20} />} color="text-violet-600" />
        <KPICard label="Earned YTD" value={currencyFmt.format(earnedYTD)} icon={<TrendingUp size={20} />} color="text-emerald-600" />
        <KPICard label="Expenses Remaining" value={currencyFmt.format(remaining)} icon={<AlertTriangle size={20} />} color={remaining < 0 ? 'text-red-600' : 'text-slate-600'} />
        <KPICard
          label="Budget Used"
          value={`${pctUsed.toFixed(1)}%`}
          icon={<Percent size={20} />}
          color={pctUsed > 100 ? 'text-red-600' : pctUsed > 80 ? 'text-amber-600' : 'text-emerald-600'}
        />
      </div>

      {/* NOI Trend Chart */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8">
        <h3 className="text-lg font-black italic uppercase text-slate-900 mb-6">NOI Trend</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fontWeight: 700 }} />
            <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v: any) => currencyFmt.format(Number(v) || 0)} />
            <Legend />
            <Line type="monotone" dataKey="budgetNOI" name="Budget" stroke="#7c3aed" strokeDasharray="5 5" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="actualNOI" name="Actual" stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
            <Line type="monotone" dataKey="forecastNOI" name="Forecast" stroke="#8b5cf6" strokeDasharray="2 2" strokeWidth={1.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Top Variances */}
      {topVariances.length > 0 && (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-slate-100">
            <h3 className="text-lg font-black italic uppercase text-slate-900">Top Variances (YTD)</h3>
          </div>
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr>
                <th className="px-8 py-4">Category</th>
                <th className="px-8 py-4">Type</th>
                <th className="px-8 py-4 text-right">Budget</th>
                <th className="px-8 py-4 text-right">Actual</th>
                <th className="px-8 py-4 text-right">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {topVariances.map((row) => {
                const favorable =
                  (row.line_type === 'Income' && row.variance_dollars > 0) ||
                  (row.line_type === 'Expense' && row.variance_dollars < 0)
                return (
                  <tr key={`${row.line_type}-${row.category}`} className="hover:bg-slate-50/50">
                    <td className="px-8 py-4 font-bold text-sm">{row.category}</td>
                    <td className="px-8 py-4">
                      <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${row.line_type === 'Income' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-500'}`}>
                        {row.line_type}
                      </span>
                    </td>
                    <td className="px-8 py-4 text-right font-mono text-sm">{currencyFmt.format(row.budget_amount)}</td>
                    <td className="px-8 py-4 text-right font-mono text-sm">{currencyFmt.format(row.actual_amount)}</td>
                    <td className="px-8 py-4 text-right">
                      <span className={`font-mono text-sm font-bold ${favorable ? 'text-emerald-600' : 'text-red-600'}`}>
                        {favorable ? <ArrowUpRight size={14} className="inline mr-1" /> : <ArrowDownRight size={14} className="inline mr-1" />}
                        {currencyFmt.format(Math.abs(row.variance_dollars))}
                        <span className="text-[10px] ml-1">({pctFmt(row.variance_pct)})</span>
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 2: Budget Editor
// ═══════════════════════════════════════════════════

function EditorTab({
  propertyId,
  fiscalYear,
  budget,
  propertyName,
}: {
  propertyId: string
  fiscalYear: number
  budget: Budget | null
  propertyName: string
}) {
  const { data: detail, isLoading } = useBudgetDetail(budget?.id ?? null)
  const mutations = useBudgetMutations()

  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatType, setNewCatType] = useState<'Income' | 'Expense'>('Expense')
  const [showAddRow, setShowAddRow] = useState(false)

  const lineItems = detail?.lineItems ?? []
  const incomeItems = lineItems.filter((li) => li.line_type === 'Income')
  const expenseItems = lineItems.filter((li) => li.line_type === 'Expense')
  const isDraft = budget?.status === 'Draft'

  // Totals
  const totalsByMonth = useMemo(() => {
    const result = { income: Array(12).fill(0), expense: Array(12).fill(0) }
    lineItems.forEach((li) => {
      const target = li.line_type === 'Income' ? result.income : result.expense
      MONTH_KEYS.forEach((k, i) => { target[i] += Number(li[k]) || 0 })
    })
    return result
  }, [lineItems])

  const incomeTotal = totalsByMonth.income.reduce((a, b) => a + b, 0)
  const expenseTotal = totalsByMonth.expense.reduce((a, b) => a + b, 0)

  const handleCellBlur = useCallback(
    (item: BudgetLineItem, monthKey: typeof MONTH_KEYS[number], newVal: number) => {
      if (Number(item[monthKey]) === newVal) return
      mutations.updateLineItem.mutate({
        lineItemId: item.id,
        updates: { [monthKey]: newVal },
      })
    },
    [mutations.updateLineItem],
  )

  const handleAddRow = () => {
    if (!newCatName.trim() || !budget) return
    mutations.addLineItem.mutate(
      { budgetId: budget.id, category: newCatName.trim(), lineType: newCatType },
      { onSuccess: () => { setNewCatName(''); setShowAddRow(false); toast.success('Category added') } },
    )
  }

  const handleDeleteRow = (id: string) => {
    mutations.deleteLineItem.mutate(id, { onSuccess: () => toast.success('Row removed') })
  }

  const handleApprove = () => {
    if (!budget) return
    mutations.updateBudgetStatus.mutate(
      { budgetId: budget.id, status: 'Approved' },
      { onSuccess: () => toast.success('Budget approved') },
    )
  }

  const handleLock = () => {
    if (!budget) return
    mutations.updateBudgetStatus.mutate(
      { budgetId: budget.id, status: 'Locked' },
      { onSuccess: () => toast.success('Budget locked') },
    )
  }

  const handleUnlock = () => {
    if (!budget) return
    mutations.updateBudgetStatus.mutate(
      { budgetId: budget.id, status: 'Draft' },
      { onSuccess: () => toast.success('Budget unlocked — returned to Draft') },
    )
  }

  // No budget — show create
  if (!budget) {
    return (
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-16 text-center">
          <BarChart3 size={48} className="mx-auto text-slate-200 mb-4" />
          <p className="text-lg font-bold text-slate-500 mb-6">No budget exists for {propertyName} in {fiscalYear}</p>
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-violet-600 text-white px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-violet-700 transition-colors"
            >
              <Plus size={16} /> Create Budget
            </button>
            <button
              onClick={() => {
                mutations.copyFromPriorYear.mutate(
                  { propertyId, targetYear: fiscalYear },
                  {
                    onSuccess: () => toast.success(`Copied from ${fiscalYear - 1}`),
                    onError: (err) => toast.error((err as Error).message),
                  },
                )
              }}
              disabled={mutations.copyFromPriorYear.isPending}
              className="flex items-center gap-2 bg-white text-slate-700 px-6 py-3 rounded-xl font-black text-xs uppercase tracking-widest border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <Copy size={16} /> Copy from {fiscalYear - 1}
            </button>
          </div>
        </div>

        <CreateBudgetModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          propertyId={propertyId}
          propertyName={propertyName}
          fiscalYear={fiscalYear}
          onCreate={mutations.createBudget}
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto flex justify-center py-20">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Budget header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-black italic text-slate-900">{budget.name}</h3>
          <StatusBadge status={budget.status} />
        </div>
        <div className="flex gap-2">
          {isDraft && (
            <button onClick={handleApprove} className="flex items-center gap-1.5 bg-emerald-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700">
              <CheckCircle2 size={14} /> Approve
            </button>
          )}
          {budget.status === 'Approved' && (
            <button onClick={handleLock} className="flex items-center gap-1.5 bg-slate-700 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800">
              <Lock size={14} /> Lock
            </button>
          )}
          {budget.status === 'Locked' && (
            <button onClick={handleUnlock} className="flex items-center gap-1.5 bg-amber-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-amber-700">
              <LockOpen size={14} /> Unlock
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left min-w-[1100px]">
          <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <tr>
              <th className="px-4 py-4 sticky left-0 bg-slate-50 z-10 min-w-[180px]">Category</th>
              {MONTH_LABELS.map((m) => (
                <th key={m} className="px-2 py-4 text-right w-[80px]">{m}</th>
              ))}
              <th className="px-4 py-4 text-right w-[100px]">Annual</th>
              {isDraft && <th className="px-2 py-4 w-[40px]" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {/* INCOME section */}
            <SectionHeader label="INCOME" colSpan={isDraft ? 15 : 14} color="emerald" />
            {incomeItems.map((item) => (
              <GridRow key={item.id} item={item} editable={isDraft} onCellBlur={handleCellBlur} onDelete={handleDeleteRow} />
            ))}
            <TotalRow label="Total Income" months={totalsByMonth.income} total={incomeTotal} color="emerald" extraCol={isDraft} />

            {/* EXPENSE section */}
            <SectionHeader label="EXPENSES" colSpan={isDraft ? 15 : 14} color="red" />
            {expenseItems.map((item) => (
              <GridRow key={item.id} item={item} editable={isDraft} onCellBlur={handleCellBlur} onDelete={handleDeleteRow} />
            ))}
            <TotalRow label="Total Expenses" months={totalsByMonth.expense} total={expenseTotal} color="red" extraCol={isDraft} />

            {/* NOI */}
            <tr className="bg-violet-50/50 font-black">
              <td className="px-4 py-3 sticky left-0 bg-violet-50/50 z-10 text-sm text-violet-900">Net Operating Income</td>
              {totalsByMonth.income.map((inc, i) => (
                <td key={i} className="px-2 py-3 text-right font-mono text-sm text-violet-700">
                  {currencyFmt.format(inc - totalsByMonth.expense[i])}
                </td>
              ))}
              <td className="px-4 py-3 text-right font-mono text-sm text-violet-900 font-black">
                {currencyFmt.format(incomeTotal - expenseTotal)}
              </td>
              {isDraft && <td />}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Add row */}
      {isDraft && (
        <div className="mt-4">
          {showAddRow ? (
            <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200 p-3">
              <input
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category name"
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm flex-1"
              />
              <select
                value={newCatType}
                onChange={(e) => setNewCatType(e.target.value as 'Income' | 'Expense')}
                className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="Income">Income</option>
                <option value="Expense">Expense</option>
              </select>
              <button onClick={handleAddRow} className="bg-violet-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-violet-700">
                Add
              </button>
              <button onClick={() => setShowAddRow(false)} className="text-slate-400 text-xs font-bold hover:text-slate-600">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAddRow(true)}
              className="flex items-center gap-1.5 text-violet-600 text-xs font-black uppercase tracking-widest hover:text-violet-800"
            >
              <Plus size={14} /> Add Category
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 3: Budget vs. Actual
// ═══════════════════════════════════════════════════

function BvaTab({
  propertyId,
  fiscalYear,
}: {
  propertyId: string
  fiscalYear: number
}) {
  const [period, setPeriod] = useState<PeriodKey>('ytd')
  const [mFrom, mTo] = periodRange(period)
  const { data: rows, isLoading } = useBudgetVsActual(propertyId, fiscalYear, mFrom, mTo)

  const incomeRows = (rows ?? []).filter((r) => r.line_type === 'Income')
  const expenseRows = (rows ?? []).filter((r) => r.line_type === 'Expense')

  const sum = (arr: BudgetVsActualRow[], key: keyof BudgetVsActualRow) =>
    arr.reduce((s, r) => s + (Number(r[key]) || 0), 0)

  const incomeBudget = sum(incomeRows, 'budget_amount')
  const incomeActual = sum(incomeRows, 'actual_amount')
  const expenseBudget = sum(expenseRows, 'budget_amount')
  const expenseActual = sum(expenseRows, 'actual_amount')

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Period selector */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-2">Period</span>
        {(['mtd', 'qtd', 'ytd', 'full'] as PeriodKey[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              period === p
                ? 'bg-slate-900 text-white shadow-md'
                : 'bg-white text-slate-400 border border-slate-200 hover:text-slate-600'
            }`}
          >
            {p === 'full' ? 'Full Year' : p.toUpperCase()}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-violet-500" size={32} /></div>
      ) : (rows ?? []).length === 0 ? (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-16 text-center">
          <p className="text-slate-400 font-bold">No budget or actual data for this period</p>
        </div>
      ) : (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4 text-right">Budget</th>
                <th className="px-6 py-4 text-right">Actual</th>
                <th className="px-6 py-4 text-right">Variance ($)</th>
                <th className="px-6 py-4 text-right">Variance (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {/* Income */}
              <tr className="bg-emerald-50/40">
                <td colSpan={5} className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-700">Income</td>
              </tr>
              {incomeRows.map((row) => (
                <BvaRow key={row.category} row={row} />
              ))}
              <BvaSummaryRow label="Total Income" budget={incomeBudget} actual={incomeActual} isIncome />

              {/* Expenses */}
              <tr className="bg-red-50/40">
                <td colSpan={5} className="px-6 py-3 text-[10px] font-black uppercase tracking-widest text-red-600">Expenses</td>
              </tr>
              {expenseRows.map((row) => (
                <BvaRow key={row.category} row={row} />
              ))}
              <BvaSummaryRow label="Total Expenses" budget={expenseBudget} actual={expenseActual} isIncome={false} />

              {/* NOI */}
              <tr className="bg-violet-50/50 font-black">
                <td className="px-6 py-4 text-sm text-violet-900">Net Operating Income</td>
                <td className="px-6 py-4 text-right font-mono text-sm">{currencyFmt.format(incomeBudget - expenseBudget)}</td>
                <td className="px-6 py-4 text-right font-mono text-sm">{currencyFmt.format(incomeActual - expenseActual)}</td>
                <td className="px-6 py-4 text-right font-mono text-sm font-bold text-violet-700">
                  {currencyFmt.format((incomeActual - expenseActual) - (incomeBudget - expenseBudget))}
                </td>
                <td className="px-6 py-4 text-right font-mono text-sm">
                  {(incomeBudget - expenseBudget) !== 0
                    ? pctFmt((((incomeActual - expenseActual) - (incomeBudget - expenseBudget)) / Math.abs(incomeBudget - expenseBudget)) * 100)
                    : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// TAB 4: Forecast
// ═══════════════════════════════════════════════════

function ForecastTab({
  propertyId,
  fiscalYear,
}: {
  propertyId: string
  fiscalYear: number
}) {
  const [vacancyRate, setVacancyRate] = useState(5)
  const { data: forecastData, isLoading, refetch } = useForecast(propertyId, fiscalYear, vacancyRate)
  const [expiringLeases, setExpiringLeases] = useState<any[]>([])
  const [leasesLoading, setLeasesLoading] = useState(true)

  // Fetch expiring leases
  useEffect(() => {
    setLeasesLoading(true)
    ;(async () => {
      const { data } = await supabase
        .from('leases')
        .select('id, rent_amount, end_date, status, units (name), tenants (first_name, last_name)')
        .eq('status', 'Active')
        .not('end_date', 'is', null)
        .gte('end_date', `${fiscalYear}-01-01`)
        .lte('end_date', `${fiscalYear}-12-31`)
        .order('end_date', { ascending: true })
        .limit(20)
      setExpiringLeases(data ?? [])
      setLeasesLoading(false)
    })()
  }, [fiscalYear])

  const chartData = useMemo(() => {
    return (forecastData ?? []).map((m) => ({
      month: MONTH_LABELS[m.month_num - 1],
      income: m.projected_income,
      expenses: m.projected_expenses,
      noi: m.projected_noi,
    }))
  }, [forecastData])

  const totalIncome = (forecastData ?? []).reduce((s, m) => s + m.projected_income, 0)
  const totalExpenses = (forecastData ?? []).reduce((s, m) => s + m.projected_expenses, 0)
  const activeLeaseCount = (forecastData ?? []).length > 0 ? Math.round((forecastData![0].projected_income / (1 - vacancyRate / 100)) / ((forecastData![0].projected_income / (1 - vacancyRate / 100)) / Math.max(1, 1))) : 0

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Controls */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Vacancy Rate</label>
          <input
            type="number"
            value={vacancyRate}
            onChange={(e) => setVacancyRate(Number(e.target.value) || 0)}
            className="w-20 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm font-bold text-center"
            min={0}
            max={100}
            step={0.5}
          />
          <span className="text-sm text-slate-400">%</span>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 bg-violet-600 text-white px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-violet-700"
        >
          <TrendingUp size={14} /> Refresh Forecast
        </button>
      </div>

      {/* KPI summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <KPICard label="Projected Annual Income" value={currencyFmt.format(totalIncome)} icon={<TrendingUp size={20} />} color="text-emerald-600" />
        <KPICard label="Projected Annual Expenses" value={currencyFmt.format(totalExpenses)} icon={<AlertTriangle size={20} />} color="text-red-500" />
        <KPICard label="Projected NOI" value={currencyFmt.format(totalIncome - totalExpenses)} icon={<DollarSign size={20} />} color="text-violet-600" />
      </div>

      {/* Cash flow chart */}
      {isLoading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-violet-500" size={32} /></div>
      ) : (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8">
          <h3 className="text-lg font-black italic uppercase text-slate-900 mb-6">Cash Flow Projection</h3>
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fontWeight: 700 }} />
              <YAxis tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: any) => currencyFmt.format(Number(v) || 0)} />
              <Legend />
              <Bar dataKey="income" name="Income" fill="#059669" radius={[4, 4, 0, 0]} barSize={20} />
              <Bar dataKey="expenses" name="Expenses" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={20} />
              <Line type="monotone" dataKey="noi" name="NOI" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3 }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Expiring leases */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-8 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 bg-amber-50 text-amber-500 rounded-xl flex items-center justify-center">
            <CalendarClock size={18} />
          </div>
          <div>
            <h3 className="text-lg font-black italic uppercase text-slate-900">Lease Expirations ({fiscalYear})</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{expiringLeases.length} leases expiring</p>
          </div>
        </div>

        {leasesLoading ? (
          <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-300" /></div>
        ) : expiringLeases.length === 0 ? (
          <div className="p-10 text-center text-slate-400 font-bold text-sm">No leases expiring in {fiscalYear}</div>
        ) : (
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-widest text-slate-400">
              <tr>
                <th className="px-8 py-4">Tenant</th>
                <th className="px-8 py-4">Unit</th>
                <th className="px-8 py-4">Rent</th>
                <th className="px-8 py-4">Expires</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {expiringLeases.map((l: any) => (
                <tr key={l.id} className="hover:bg-slate-50/50">
                  <td className="px-8 py-3 font-bold text-sm">
                    {l.tenants?.first_name} {l.tenants?.last_name}
                  </td>
                  <td className="px-8 py-3 text-sm text-slate-600">{l.units?.name}</td>
                  <td className="px-8 py-3 font-mono text-sm">{currencyFmt.format(l.rent_amount)}</td>
                  <td className="px-8 py-3 text-sm font-bold text-amber-600">
                    {new Date(l.end_date).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Key Assumptions */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-8">
        <h3 className="text-lg font-black italic uppercase text-slate-900 mb-4">Key Assumptions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Vacancy Rate</p>
            <p className="text-xl font-black text-slate-900">{vacancyRate}%</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Avg Monthly Expense</p>
            <p className="text-xl font-black text-slate-900">
              {totalExpenses > 0 ? currencyFmt.format(totalExpenses / 12) : '$0'}
            </p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Expiring Leases</p>
            <p className="text-xl font-black text-amber-600">{expiringLeases.length}</p>
          </div>
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Annual Revenue Impact</p>
            <p className="text-xl font-black text-slate-900">
              {currencyFmt.format(expiringLeases.reduce((s: number, l: any) => s + (l.rent_amount || 0), 0) * 12)}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════
// Shared Sub-Components
// ═══════════════════════════════════════════════════

function KPICard({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm">
      <div className="p-3 bg-slate-50 text-slate-900 rounded-xl inline-block mb-4">{icon}</div>
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <h2 className={`text-3xl font-black italic tracking-tighter ${color}`}>{value}</h2>
    </div>
  )
}

function StatusBadge({ status }: { status: BudgetStatus }) {
  const styles = {
    Draft: 'bg-amber-50 text-amber-600',
    Approved: 'bg-emerald-50 text-emerald-600',
    Locked: 'bg-slate-100 text-slate-500',
  }
  const icons = {
    Draft: null,
    Approved: <CheckCircle2 size={12} />,
    Locked: <Lock size={12} />,
  }
  return (
    <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${styles[status]}`}>
      {icons[status]} {status}
    </span>
  )
}

function SectionHeader({ label, colSpan, color }: { label: string; colSpan: number; color: string }) {
  return (
    <tr className={color === 'emerald' ? 'bg-emerald-50/40' : 'bg-red-50/40'}>
      <td
        colSpan={colSpan}
        className={`px-4 py-3 text-[10px] font-black uppercase tracking-widest ${color === 'emerald' ? 'text-emerald-700' : 'text-red-600'}`}
      >
        {label}
      </td>
    </tr>
  )
}

function GridRow({
  item,
  editable,
  onCellBlur,
  onDelete,
}: {
  item: BudgetLineItem
  editable: boolean
  onCellBlur: (item: BudgetLineItem, key: typeof MONTH_KEYS[number], val: number) => void
  onDelete: (id: string) => void
}) {
  const annual = lineItemAnnualTotal(item)

  return (
    <tr className="hover:bg-slate-50/50 transition-colors">
      <td className="px-4 py-2 sticky left-0 bg-white z-10 text-sm font-bold text-slate-800">{item.category}</td>
      {MONTH_KEYS.map((mk) => (
        <td key={mk} className="px-1 py-1 text-right">
          {editable ? (
            <input
              type="number"
              defaultValue={Number(item[mk]) || 0}
              onBlur={(e) => onCellBlur(item, mk, Number(e.target.value) || 0)}
              className="w-full text-right font-mono text-sm px-1.5 py-1 border border-transparent hover:border-slate-200 focus:border-violet-400 focus:ring-1 focus:ring-violet-200 rounded outline-none bg-transparent"
              min={0}
            />
          ) : (
            <span className="font-mono text-sm text-slate-600 px-1.5">
              {Number(item[mk]) > 0 ? Number(item[mk]).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
            </span>
          )}
        </td>
      ))}
      <td className="px-4 py-2 text-right font-mono text-sm font-bold text-slate-900">
        {currencyFmt.format(annual)}
      </td>
      {editable && (
        <td className="px-2 py-2 text-center">
          <button onClick={() => onDelete(item.id)} className="text-slate-300 hover:text-red-500 transition-colors">
            <Trash2 size={14} />
          </button>
        </td>
      )}
    </tr>
  )
}

function TotalRow({
  label,
  months,
  total,
  color,
  extraCol,
}: {
  label: string
  months: number[]
  total: number
  color: string
  extraCol: boolean
}) {
  const textColor = color === 'emerald' ? 'text-emerald-700' : 'text-red-600'
  return (
    <tr className={`font-black ${color === 'emerald' ? 'bg-emerald-50/30' : 'bg-red-50/30'}`}>
      <td className={`px-4 py-3 sticky left-0 z-10 text-sm ${textColor} ${color === 'emerald' ? 'bg-emerald-50/30' : 'bg-red-50/30'}`}>
        {label}
      </td>
      {months.map((m, i) => (
        <td key={i} className={`px-2 py-3 text-right font-mono text-sm ${textColor}`}>
          {currencyFmt.format(m)}
        </td>
      ))}
      <td className={`px-4 py-3 text-right font-mono text-sm ${textColor}`}>
        {currencyFmt.format(total)}
      </td>
      {extraCol && <td />}
    </tr>
  )
}

function BvaRow({ row }: { row: BudgetVsActualRow }) {
  const favorable =
    (row.line_type === 'Income' && row.variance_dollars > 0) ||
    (row.line_type === 'Expense' && row.variance_dollars < 0)

  return (
    <tr className="hover:bg-slate-50/50 transition-colors">
      <td className="px-6 py-3 text-sm font-bold text-slate-800">{row.category}</td>
      <td className="px-6 py-3 text-right font-mono text-sm">{currencyFmt.format(row.budget_amount)}</td>
      <td className="px-6 py-3 text-right font-mono text-sm">{currencyFmt.format(row.actual_amount)}</td>
      <td className={`px-6 py-3 text-right font-mono text-sm font-bold ${favorable ? 'text-emerald-600' : 'text-red-600'}`}>
        {currencyFmt.format(row.variance_dollars)}
      </td>
      <td className={`px-6 py-3 text-right font-mono text-sm ${favorable ? 'text-emerald-600' : 'text-red-600'}`}>
        {row.budget_amount !== 0 ? pctFmt(row.variance_pct) : '—'}
      </td>
    </tr>
  )
}

function BvaSummaryRow({
  label,
  budget,
  actual,
  isIncome,
}: {
  label: string
  budget: number
  actual: number
  isIncome: boolean
}) {
  const variance = actual - budget
  const favorable = isIncome ? variance > 0 : variance < 0
  const pct = budget !== 0 ? (variance / budget) * 100 : 0

  return (
    <tr className="font-black bg-slate-50/50">
      <td className="px-6 py-3 text-sm text-slate-900">{label}</td>
      <td className="px-6 py-3 text-right font-mono text-sm">{currencyFmt.format(budget)}</td>
      <td className="px-6 py-3 text-right font-mono text-sm">{currencyFmt.format(actual)}</td>
      <td className={`px-6 py-3 text-right font-mono text-sm ${favorable ? 'text-emerald-600' : 'text-red-600'}`}>
        {currencyFmt.format(variance)}
      </td>
      <td className={`px-6 py-3 text-right font-mono text-sm ${favorable ? 'text-emerald-600' : 'text-red-600'}`}>
        {budget !== 0 ? pctFmt(pct) : '—'}
      </td>
    </tr>
  )
}

function CreateBudgetModal({
  isOpen,
  onClose,
  propertyId,
  propertyName,
  fiscalYear,
  onCreate,
}: {
  isOpen: boolean
  onClose: () => void
  propertyId: string
  propertyName: string
  fiscalYear: number
  onCreate: any
}) {
  const [name, setName] = useState(`${propertyName} ${fiscalYear} Budget`)
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    setSaving(true)
    try {
      await onCreate.mutateAsync({ propertyId, fiscalYear, name })
      toast.success('Budget created with default categories')
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Failed to create budget')
    } finally {
      setSaving(false)
    }
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Create Budget"
      subtitle={`${propertyName} • ${fiscalYear}`}
      size="max-w-md"
      headerBg="bg-violet-50"
      headerTextColor="text-violet-900"
    >
      <div className="p-6 space-y-5">
        <div>
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1 block">Budget Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm"
          />
        </div>
        <div className="bg-violet-50 rounded-xl p-4 text-sm text-violet-700">
          <ShieldCheck size={16} className="inline mr-2" />
          Standard income &amp; expense categories will be added automatically. You can customize them in the editor.
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 bg-violet-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            Create Budget
          </button>
        </div>
      </div>
    </AccessibleModal>
  )
}
