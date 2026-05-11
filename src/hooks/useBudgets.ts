import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──

export type BudgetStatus = 'Draft' | 'Approved' | 'Locked'

export type Budget = {
  id: string
  property_id: string
  property_name: string
  fiscal_year: number
  name: string
  status: BudgetStatus
  notes: string | null
  created_by: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export type BudgetLineItem = {
  id: string
  budget_id: string
  category: string
  line_type: 'Income' | 'Expense'
  gl_account_id: string | null
  month_1: number
  month_2: number
  month_3: number
  month_4: number
  month_5: number
  month_6: number
  month_7: number
  month_8: number
  month_9: number
  month_10: number
  month_11: number
  month_12: number
  sort_order: number
}

export type BudgetVsActualRow = {
  category: string
  line_type: string
  budget_amount: number
  actual_amount: number
  variance_dollars: number
  variance_pct: number
}

export type ForecastMonth = {
  month_num: number
  projected_income: number
  projected_expenses: number
  projected_noi: number
}

export type MonthlyActual = {
  property_id: string
  fiscal_year: number
  month_num: number
  line_type: string
  category: string
  actual_amount: number
}

export const MONTH_KEYS = [
  'month_1', 'month_2', 'month_3', 'month_4', 'month_5', 'month_6',
  'month_7', 'month_8', 'month_9', 'month_10', 'month_11', 'month_12',
] as const

export const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export function lineItemAnnualTotal(item: BudgetLineItem): number {
  return MONTH_KEYS.reduce((sum, k) => sum + (Number(item[k]) || 0), 0)
}

// ── Fetch helpers ──

async function fetchProperties(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .order('name')
  if (error) throw error
  return data ?? []
}

async function fetchBudgetList(
  propertyId?: string,
  fiscalYear?: number,
): Promise<Budget[]> {
  let query = supabase
    .from('budgets')
    .select('*, properties (name)')
    .order('fiscal_year', { ascending: false })

  if (propertyId) query = query.eq('property_id', propertyId)
  if (fiscalYear) query = query.eq('fiscal_year', fiscalYear)

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((b: any) => ({
    id: b.id,
    property_id: b.property_id,
    property_name: b.properties?.name || 'Unknown',
    fiscal_year: b.fiscal_year,
    name: b.name,
    status: b.status,
    notes: b.notes,
    created_by: b.created_by,
    approved_by: b.approved_by,
    approved_at: b.approved_at,
    created_at: b.created_at,
    updated_at: b.updated_at,
  }))
}

async function fetchBudgetDetail(
  budgetId: string,
): Promise<{ budget: Budget; lineItems: BudgetLineItem[] }> {
  const [budgetRes, itemsRes] = await Promise.all([
    supabase
      .from('budgets')
      .select('*, properties (name)')
      .eq('id', budgetId)
      .single(),
    supabase
      .from('budget_line_items')
      .select('*')
      .eq('budget_id', budgetId)
      .order('line_type', { ascending: true })
      .order('sort_order', { ascending: true }),
  ])

  if (budgetRes.error) throw budgetRes.error
  if (itemsRes.error) throw itemsRes.error

  const b: any = budgetRes.data
  const budget: Budget = {
    id: b.id,
    property_id: b.property_id,
    property_name: b.properties?.name || 'Unknown',
    fiscal_year: b.fiscal_year,
    name: b.name,
    status: b.status,
    notes: b.notes,
    created_by: b.created_by,
    approved_by: b.approved_by,
    approved_at: b.approved_at,
    created_at: b.created_at,
    updated_at: b.updated_at,
  }

  return { budget, lineItems: itemsRes.data ?? [] }
}

async function fetchBudgetVsActual(
  propertyId: string,
  fiscalYear: number,
  monthFrom: number,
  monthTo: number,
): Promise<BudgetVsActualRow[]> {
  const { data, error } = await supabase.rpc('get_budget_vs_actual', {
    p_property_id: propertyId,
    p_fiscal_year: fiscalYear,
    p_month_from: monthFrom,
    p_month_to: monthTo,
  })
  if (error) throw error
  return data ?? []
}

async function fetchForecast(
  propertyId: string,
  fiscalYear: number,
  vacancyRate: number,
): Promise<ForecastMonth[]> {
  const { data, error } = await supabase.rpc('get_forecast_projection', {
    p_property_id: propertyId,
    p_fiscal_year: fiscalYear,
    p_vacancy_rate: vacancyRate,
  })
  if (error) throw error
  return data ?? []
}

async function fetchMonthlyActuals(
  propertyId: string,
  fiscalYear: number,
): Promise<MonthlyActual[]> {
  const { data, error } = await supabase
    .from('budget_actuals_monthly')
    .select('*')
    .eq('property_id', propertyId)
    .eq('fiscal_year', fiscalYear)
  if (error) throw error
  return data ?? []
}

// ── Query hooks ──

export function useBudgetProperties() {
  return useQuery({
    queryKey: ['budget-properties'],
    queryFn: fetchProperties,
    staleTime: 5 * 60_000,
  })
}

export function useBudgetList(propertyId?: string, fiscalYear?: number) {
  return useQuery({
    queryKey: ['budgets', propertyId, fiscalYear],
    queryFn: () => fetchBudgetList(propertyId, fiscalYear),
  })
}

export function useBudgetDetail(budgetId: string | null) {
  return useQuery({
    queryKey: ['budget-detail', budgetId],
    queryFn: () => fetchBudgetDetail(budgetId!),
    enabled: !!budgetId,
  })
}

export function useBudgetVsActual(
  propertyId: string | null,
  fiscalYear: number,
  monthFrom: number,
  monthTo: number,
) {
  return useQuery({
    queryKey: ['budget-vs-actual', propertyId, fiscalYear, monthFrom, monthTo],
    queryFn: () => fetchBudgetVsActual(propertyId!, fiscalYear, monthFrom, monthTo),
    enabled: !!propertyId,
  })
}

export function useForecast(
  propertyId: string | null,
  fiscalYear: number,
  vacancyRate: number,
) {
  return useQuery({
    queryKey: ['forecast', propertyId, fiscalYear, vacancyRate],
    queryFn: () => fetchForecast(propertyId!, fiscalYear, vacancyRate),
    enabled: !!propertyId,
  })
}

export function useMonthlyActuals(
  propertyId: string | null,
  fiscalYear: number,
) {
  return useQuery({
    queryKey: ['monthly-actuals', propertyId, fiscalYear],
    queryFn: () => fetchMonthlyActuals(propertyId!, fiscalYear),
    enabled: !!propertyId,
  })
}

// ── Mutations ──

export function useBudgetMutations() {
  const qc = useQueryClient()

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['budgets'] })
    qc.invalidateQueries({ queryKey: ['budget-detail'] })
    qc.invalidateQueries({ queryKey: ['budget-vs-actual'] })
    qc.invalidateQueries({ queryKey: ['forecast'] })
    qc.invalidateQueries({ queryKey: ['monthly-actuals'] })
  }

  const createBudget = useMutation({
    mutationFn: async ({
      propertyId,
      fiscalYear,
      name,
    }: {
      propertyId: string
      fiscalYear: number
      name: string
    }) => {
      const { data: user } = await supabase.auth.getUser()

      const { data, error } = await supabase
        .from('budgets')
        .insert({
          property_id: propertyId,
          fiscal_year: fiscalYear,
          name,
          created_by: user.user?.id ?? null,
        })
        .select('id')
        .single()

      if (error) throw error

      // Seed default categories
      const { error: seedErr } = await supabase.rpc('seed_budget_categories', {
        p_budget_id: data.id,
      })
      if (seedErr) {
        console.error('Seed error:', seedErr)
        toast.warning('Budget created but default categories could not be seeded')
      }

      return data.id as string
    },
    onSuccess: () => {
      toast.success('Budget created')
      invalidateAll()
    },
    onError: (err: any) => toast.error('Failed to create budget: ' + err.message),
  })

  const updateBudgetStatus = useMutation({
    mutationFn: async ({
      budgetId,
      status,
    }: {
      budgetId: string
      status: BudgetStatus
    }) => {
      const updates: Record<string, any> = { status, updated_at: new Date().toISOString() }

      if (status === 'Approved') {
        const { data: user } = await supabase.auth.getUser()
        updates.approved_by = user.user?.id ?? null
        updates.approved_at = new Date().toISOString()
      }

      const { error } = await supabase
        .from('budgets')
        .update(updates)
        .eq('id', budgetId)

      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Budget status updated')
      invalidateAll()
    },
    onError: (err: any) => toast.error('Failed to update status: ' + err.message),
  })

  const updateLineItem = useMutation({
    mutationFn: async ({
      lineItemId,
      updates,
    }: {
      lineItemId: string
      updates: Partial<Record<typeof MONTH_KEYS[number], number>>
    }) => {
      const { error } = await supabase
        .from('budget_line_items')
        .update(updates)
        .eq('id', lineItemId)

      if (error) throw error
    },
    onSuccess: invalidateAll,
    onError: (err: any) => toast.error('Failed to update line item: ' + err.message),
  })

  const addLineItem = useMutation({
    mutationFn: async ({
      budgetId,
      category,
      lineType,
      sortOrder,
    }: {
      budgetId: string
      category: string
      lineType: 'Income' | 'Expense'
      sortOrder?: number
    }) => {
      const { error } = await supabase.from('budget_line_items').insert({
        budget_id: budgetId,
        category,
        line_type: lineType,
        sort_order: sortOrder ?? (lineType === 'Income' ? 5 : 19),
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Line item added')
      invalidateAll()
    },
    onError: (err: any) => toast.error('Failed to add line item: ' + err.message),
  })

  const deleteLineItem = useMutation({
    mutationFn: async (lineItemId: string) => {
      const { error } = await supabase
        .from('budget_line_items')
        .delete()
        .eq('id', lineItemId)
      if (error) throw error
    },
    onSuccess: invalidateAll,
    onError: (err: any) => toast.error('Failed to delete line item: ' + err.message),
  })

  const copyFromPriorYear = useMutation({
    mutationFn: async ({
      propertyId,
      targetYear,
    }: {
      propertyId: string
      targetYear: number
    }) => {
      const { data, error } = await supabase.rpc('copy_budget_from_prior_year', {
        p_property_id: propertyId,
        p_target_year: targetYear,
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => {
      toast.success('Budget copied from prior year')
      invalidateAll()
    },
    onError: (err: any) => toast.error('Failed to copy budget: ' + err.message),
  })

  return {
    createBudget,
    updateBudgetStatus,
    updateLineItem,
    addLineItem,
    deleteLineItem,
    copyFromPriorYear,
  }
}
