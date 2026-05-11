import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──

export type Bill = {
  id: string
  vendor_id: string
  property_id: string | null
  work_order_id: string | null
  invoice_number: string | null
  description: string
  amount: number
  due_date: string
  category: string
  gl_account_id: string | null
  status: string
  file_url: string | null
  file_name: string | null
  submitted_by: string | null
  approved_by: string | null
  approved_at: string | null
  paid_at: string | null
  paid_reference: string | null
  notes: string | null
  ledger_committed: boolean
  created_at: string
  updated_at: string
  vendor_name?: string
  property_name?: string
  gl_account_name?: string
}

export type APAgingEntry = {
  id: string
  vendor_id: string
  vendor_name: string
  vendor_contact: string | null
  invoice_number: string | null
  description: string
  amount: number
  due_date: string
  status: string
  property_id: string | null
  property_name: string | null
  category: string
  created_at: string
  aging_bucket: string
}

export type APAgingSummary = {
  total_outstanding: number
  current: number
  '1_30': number
  '31_60': number
  '61_90': number
  '90_plus': number
}

export type BillFilters = {
  status?: string
  vendor_id?: string
  property_id?: string
}

// ── Constants ──

export const BILL_STATUS_OPTIONS = [
  { value: 'Draft', label: 'Draft', color: 'bg-slate-100 text-slate-600' },
  { value: 'Pending Approval', label: 'Pending Approval', color: 'bg-amber-100 text-amber-700' },
  { value: 'Approved', label: 'Approved', color: 'bg-blue-100 text-blue-700' },
  { value: 'Scheduled', label: 'Scheduled', color: 'bg-indigo-100 text-indigo-700' },
  { value: 'Paid', label: 'Paid', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'Void', label: 'Void', color: 'bg-red-100 text-red-600' },
]

// ── Fetch helpers ──

async function fetchBills(filters?: BillFilters): Promise<Bill[]> {
  let query = supabase
    .from('bills')
    .select(`
      *,
      vendors ( company_name, contact_name ),
      properties ( name ),
      gl_accounts ( name, code )
    `)
    .order('due_date', { ascending: false })

  if (filters?.status) query = query.eq('status', filters.status)
  if (filters?.vendor_id) query = query.eq('vendor_id', filters.vendor_id)
  if (filters?.property_id) query = query.eq('property_id', filters.property_id)

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((b: any) => ({
    id: b.id,
    vendor_id: b.vendor_id,
    property_id: b.property_id,
    work_order_id: b.work_order_id,
    invoice_number: b.invoice_number,
    description: b.description,
    amount: Number(b.amount) || 0,
    due_date: b.due_date,
    category: b.category,
    gl_account_id: b.gl_account_id,
    status: b.status,
    file_url: b.file_url,
    file_name: b.file_name,
    submitted_by: b.submitted_by,
    approved_by: b.approved_by,
    approved_at: b.approved_at,
    paid_at: b.paid_at,
    paid_reference: b.paid_reference,
    notes: b.notes,
    ledger_committed: b.ledger_committed ?? false,
    created_at: b.created_at,
    updated_at: b.updated_at,
    vendor_name: b.vendors?.company_name || undefined,
    property_name: b.properties?.name || undefined,
    gl_account_name: b.gl_accounts ? `${b.gl_accounts.code} - ${b.gl_accounts.name}` : undefined,
  }))
}

async function fetchAPAging(): Promise<APAgingEntry[]> {
  const { data, error } = await supabase
    .from('view_ap_aging')
    .select('*')
    .order('due_date', { ascending: true })

  if (error) throw error
  return (data ?? []) as APAgingEntry[]
}

async function fetchGLAccounts(): Promise<{ id: string; code: string; name: string; account_type: string }[]> {
  const { data, error } = await supabase
    .from('gl_accounts')
    .select('id, code, name, account_type')
    .eq('account_type', 'Expense')
    .order('code')

  if (error) throw error
  return data ?? []
}

// ── Query hooks ──

export function useAccountsPayable(filters?: BillFilters) {
  const queryClient = useQueryClient()

  const { data: bills, isLoading } = useQuery({
    queryKey: ['bills', filters?.status, filters?.vendor_id, filters?.property_id],
    queryFn: () => fetchBills(filters),
  })

  const createBill = useMutation({
    mutationFn: async (payload: {
      vendor_id: string
      property_id?: string | null
      work_order_id?: string | null
      invoice_number?: string | null
      description: string
      amount: number
      due_date: string
      category: string
      gl_account_id?: string | null
      status?: string
      file_url?: string | null
      file_name?: string | null
      notes?: string | null
      ocr_extracted_fields?: Record<string, unknown> | null
      ocr_confidence?: number | null
      ocr_model?: string | null
      ocr_processed_at?: string | null
      ocr_reviewed?: boolean
    }) => {
      const { data: user } = await supabase.auth.getUser()

      const { data, error } = await supabase
        .from('bills')
        .insert({
          ...payload,
          status: payload.status || 'Draft',
          submitted_by: user.user?.id ?? null,
        })
        .select('id')
        .single()

      if (error) throw error
      return data.id as string
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['ap-aging'] })
      toast.success('Bill created')
    },
    onError: (err: Error) => toast.error('Failed to create bill: ' + err.message),
  })

  const updateBill = useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Partial<Omit<Bill, 'id' | 'created_at' | 'updated_at' | 'vendor_name' | 'property_name' | 'gl_account_name'>>
    }) => {
      const { error } = await supabase
        .from('bills')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['ap-aging'] })
      toast.success('Bill updated')
    },
    onError: (err: Error) => toast.error('Failed to update bill: ' + err.message),
  })

  const approveBill = useMutation({
    mutationFn: async (billId: string) => {
      const { data: user } = await supabase.auth.getUser()
      const now = new Date().toISOString()

      const { error } = await supabase
        .from('bills')
        .update({
          status: 'Approved',
          approved_by: user.user?.id ?? null,
          approved_at: now,
          updated_at: now,
        })
        .eq('id', billId)

      if (error) throw error

      // Commit to general ledger
      const { error: rpcError } = await supabase.rpc('commit_bill_to_ledger', {
        p_bill_id: billId,
      })
      if (rpcError) throw rpcError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['ap-aging'] })
      toast.success('Bill approved and committed to ledger')
    },
    onError: (err: Error) => toast.error('Approval failed: ' + err.message),
  })

  const payBill = useMutation({
    mutationFn: async ({ billId, reference }: { billId: string; reference: string }) => {
      const { error } = await supabase.rpc('mark_bill_paid', {
        p_bill_id: billId,
        p_reference: reference,
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['ap-aging'] })
      toast.success('Bill marked as paid')
    },
    onError: (err: Error) => toast.error('Payment failed: ' + err.message),
  })

  const voidBill = useMutation({
    mutationFn: async (billId: string) => {
      const { error } = await supabase
        .from('bills')
        .update({
          status: 'Void',
          updated_at: new Date().toISOString(),
        })
        .eq('id', billId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['ap-aging'] })
      toast.success('Bill voided')
    },
    onError: (err: Error) => toast.error('Failed to void bill: ' + err.message),
  })

  return {
    bills: bills ?? [],
    loading: isLoading,
    createBill,
    updateBill,
    approveBill,
    payBill,
    voidBill,
    refresh: () => {
      queryClient.invalidateQueries({ queryKey: ['bills'] })
      queryClient.invalidateQueries({ queryKey: ['ap-aging'] })
    },
  }
}

export function useAPAging() {
  const { data: entries, isLoading } = useQuery({
    queryKey: ['ap-aging'],
    queryFn: fetchAPAging,
  })

  const rows = entries ?? []

  const summary: APAgingSummary = {
    total_outstanding: rows.reduce((sum, e) => sum + Number(e.amount), 0),
    current: rows.filter((e) => e.aging_bucket === 'current').reduce((sum, e) => sum + Number(e.amount), 0),
    '1_30': rows.filter((e) => e.aging_bucket === '1_30').reduce((sum, e) => sum + Number(e.amount), 0),
    '31_60': rows.filter((e) => e.aging_bucket === '31_60').reduce((sum, e) => sum + Number(e.amount), 0),
    '61_90': rows.filter((e) => e.aging_bucket === '61_90').reduce((sum, e) => sum + Number(e.amount), 0),
    '90_plus': rows.filter((e) => e.aging_bucket === '90_plus').reduce((sum, e) => sum + Number(e.amount), 0),
  }

  return {
    entries: rows,
    summary,
    loading: isLoading,
  }
}

export function useGLAccounts() {
  return useQuery({
    queryKey: ['gl-accounts-expense'],
    queryFn: fetchGLAccounts,
    staleTime: 5 * 60_000,
  })
}
