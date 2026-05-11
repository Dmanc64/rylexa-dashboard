import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'

export type DateView = 'Month' | 'Quarter' | 'YTD' | 'Custom'

export type DateRange = { start: string; end: string }

export type FinancialMetric = {
  property_id: string
  property_name: string
  total_income: number
  total_expenses: number
  net_operating_income: number
  margin: number
  occupancy_rate?: number
}

export type MaintenanceExpense = {
  id: string
  description: string
  amount: number
  date: string
  vendor_name: string | null
  work_order_title: string | null
}

type Aggregate = {
  income: number
  expenses: number
  noi: number
  margin: number
}

function getDateRange(view: DateView): { start: string; end: string } {
  const now = new Date()
  const end = now.toISOString().split('T')[0]

  if (view === 'Month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1)
    return { start: start.toISOString().split('T')[0], end }
  }
  if (view === 'Quarter') {
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3
    const start = new Date(now.getFullYear(), quarterMonth, 1)
    return { start: start.toISOString().split('T')[0], end }
  }
  // YTD
  return { start: `${now.getFullYear()}-01-01`, end }
}

async function fetchFinancials(view: DateView, customRange?: DateRange): Promise<{ metrics: FinancialMetric[]; aggregate: Aggregate; maintenanceExpenses: MaintenanceExpense[] }> {
  const { start, end } = view === 'Custom' && customRange ? customRange : getDateRange(view)

  const [pnlRes, expensesRes] = await Promise.all([
    supabase.rpc('get_profit_and_loss', {
      p_start_date: start,
      p_end_date: end,
    }),
    supabase
      .from('transactions')
      .select('id, description, amount, date, vendors!vendor_id ( company_name ), work_orders ( title )')
      .not('work_order_id', 'is', null)
      .order('date', { ascending: false })
      .limit(20),
  ])

  if (pnlRes.error) throw pnlRes.error
  if (expensesRes.error) throw expensesRes.error

  const data = pnlRes.data
  const maintenanceExpenses: MaintenanceExpense[] = (expensesRes.data ?? []).map((t: any) => ({
    id: t.id,
    description: t.description || 'Maintenance Expense',
    amount: Math.abs(t.amount || 0),
    date: t.date,
    vendor_name: t.vendors?.company_name || null,
    work_order_title: t.work_orders?.title || null,
  }))

  const metrics: FinancialMetric[] = (data ?? [])
    .map((item: any) => {
      const income = Number(item.total_income) || 0
      const expenses = Number(item.total_expenses) || 0
      const noi = Number(item.net_operating_income) || 0
      return {
        property_id: item.property_id,
        property_name: item.property_name,
        total_income: income,
        total_expenses: expenses,
        net_operating_income: noi,
        margin: income > 0 ? (noi / income) * 100 : 0,
      }
    })
    .filter((m: FinancialMetric) => m.total_income > 0 || m.total_expenses > 0)
    .sort((a: FinancialMetric, b: FinancialMetric) => b.net_operating_income - a.net_operating_income)

  const totalIncome = metrics.reduce((acc, curr) => acc + curr.total_income, 0)
  const totalExpenses = metrics.reduce((acc, curr) => acc + curr.total_expenses, 0)
  const totalNOI = metrics.reduce((acc, curr) => acc + curr.net_operating_income, 0)

  return {
    metrics,
    aggregate: {
      income: totalIncome,
      expenses: totalExpenses,
      noi: totalNOI,
      margin: totalIncome > 0 ? (totalNOI / totalIncome) * 100 : 0,
    },
    maintenanceExpenses,
  }
}

export function useFinancials(view: DateView = 'YTD', customRange?: DateRange) {
  const queryClient = useQueryClient()
  const cacheKey = view === 'Custom' && customRange
    ? ['financials', 'Custom', customRange.start, customRange.end]
    : ['financials', view]

  const { data, isLoading, error } = useQuery({
    queryKey: cacheKey,
    queryFn: () => fetchFinancials(view, customRange),
    enabled: view !== 'Custom' || (!!customRange?.start && !!customRange?.end),
  })

  return {
    metrics: data?.metrics ?? [],
    aggregate: data?.aggregate ?? { income: 0, expenses: 0, noi: 0, margin: 0 },
    maintenanceExpenses: data?.maintenanceExpenses ?? [],
    loading: isLoading,
    error,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['financials'] }),
  }
}
