import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { toast } from 'sonner'

// ── Types ──

export type TaxFormType = '1099-NEC' | '1099-MISC'
export type RecipientType = 'vendor' | 'owner'
export type TaxFormStatus = 'generated' | 'sent' | 'corrected' | 'voided'

export type PayerSettings = {
  id: string
  company_name: string
  tax_id: string
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  updated_at: string
}

export type TaxForm1099 = {
  id: string
  tax_year: number
  form_type: TaxFormType
  recipient_type: RecipientType
  recipient_id: string
  recipient_name: string
  recipient_tax_id: string | null
  total_amount: number
  status: TaxFormStatus
  storage_path: string | null
  generated_at: string
  generated_by: string
  voided_at: string | null
  notes: string | null
}

export type VendorPaymentSummary = {
  vendor_id: string
  company_name: string | null
  contact_name: string | null
  tax_id: string | null
  is_1099: boolean
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  tax_year: number
  total_paid: number
}

export type OwnerDistributionSummary = {
  owner_id: string
  full_name: string
  company_name: string | null
  tax_id: string | null
  address_street: string | null
  address_city: string | null
  address_state: string | null
  address_zip: string | null
  tax_year: number
  total_distributed: number
}

export type PayerSettingsPayload = {
  company_name: string
  tax_id: string
  address_street?: string | null
  address_city?: string | null
  address_state?: string | null
  address_zip?: string | null
  contact_name?: string | null
  contact_phone?: string | null
  contact_email?: string | null
}

// ── Constants ──

export const TAX_FORM_STATUS_OPTIONS: { value: TaxFormStatus; label: string; color: string }[] = [
  { value: 'generated', label: 'Generated', color: 'bg-emerald-100 text-emerald-700' },
  { value: 'sent', label: 'Sent', color: 'bg-blue-100 text-blue-700' },
  { value: 'corrected', label: 'Corrected', color: 'bg-amber-100 text-amber-700' },
  { value: 'voided', label: 'Voided', color: 'bg-red-100 text-red-700' },
]

export const FILING_THRESHOLD = 600

// ── Fetch helpers ──

async function fetchVendorPayments(year: number): Promise<VendorPaymentSummary[]> {
  const { data, error } = await supabase
    .from('view_vendor_annual_payments')
    .select('*')
    .eq('tax_year', year)

  if (error) throw error
  return (data ?? []) as VendorPaymentSummary[]
}

async function fetchOwnerDistributions(year: number): Promise<OwnerDistributionSummary[]> {
  const { data, error } = await supabase
    .from('view_owner_annual_distributions')
    .select('*')
    .eq('tax_year', year)

  if (error) throw error
  return (data ?? []) as OwnerDistributionSummary[]
}

async function fetchTaxForms(year: number): Promise<TaxForm1099[]> {
  const { data, error } = await supabase
    .from('tax_form_1099s')
    .select('*')
    .eq('tax_year', year)
    .order('generated_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as TaxForm1099[]
}

async function fetchPayerSettings(): Promise<PayerSettings | null> {
  const { data, error } = await supabase
    .from('payer_settings')
    .select('*')
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data as PayerSettings | null
}

// ── Query hooks ──

export function useVendorPayments(year: number) {
  return useQuery({
    queryKey: ['vendor-annual-payments', year],
    queryFn: () => fetchVendorPayments(year),
  })
}

export function useOwnerDistributions(year: number) {
  return useQuery({
    queryKey: ['owner-annual-distributions', year],
    queryFn: () => fetchOwnerDistributions(year),
  })
}

export function useTaxForms(year: number) {
  return useQuery({
    queryKey: ['tax-forms', year],
    queryFn: () => fetchTaxForms(year),
  })
}

export function usePayerSettings() {
  return useQuery({
    queryKey: ['payer-settings'],
    queryFn: fetchPayerSettings,
  })
}

// ── Mutations ──

export function useTaxFormMutations() {
  const qc = useQueryClient()

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['tax-forms'] })
    qc.invalidateQueries({ queryKey: ['vendor-annual-payments'] })
    qc.invalidateQueries({ queryKey: ['owner-annual-distributions'] })
  }

  const updatePayerSettings = useMutation({
    mutationFn: async (payload: PayerSettingsPayload) => {
      const { data: user } = await supabase.auth.getUser()

      // Check if any payer settings exist
      const { data: existing } = await supabase
        .from('payer_settings')
        .select('id')
        .limit(1)
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('payer_settings')
          .update({
            ...payload,
            updated_at: new Date().toISOString(),
            updated_by: user.user?.id,
          })
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('payer_settings')
          .insert({
            ...payload,
            updated_by: user.user?.id,
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payer-settings'] })
      toast.success('Payer settings saved')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const generateForm = useMutation({
    mutationFn: async ({
      tax_year,
      form_type,
      recipient_type,
      recipient_id,
    }: {
      tax_year: number
      form_type: TaxFormType
      recipient_type: RecipientType
      recipient_id: string
    }) => {
      const { data: result, error } = await supabase.functions.invoke('generate-1099', {
        body: { tax_year, form_type, recipient_type, recipient_id },
      })

      if (error) {
        let msg = error.message || 'Generation failed'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        throw new Error(msg)
      }

      return result as { id: string; storage_path: string }
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('1099 form generated')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const generateAllForms = useMutation({
    mutationFn: async ({
      tax_year,
      vendors,
      owners,
    }: {
      tax_year: number
      vendors: { vendor_id: string }[]
      owners: { owner_id: string }[]
    }) => {
      const results: { success: number; failed: number } = { success: 0, failed: 0 }

      // Generate vendor 1099-NECs
      for (const v of vendors) {
        try {
          const { error } = await supabase.functions.invoke('generate-1099', {
            body: {
              tax_year,
              form_type: '1099-NEC',
              recipient_type: 'vendor',
              recipient_id: v.vendor_id,
            },
          })
          if (!error) results.success++
          else results.failed++
        } catch {
          results.failed++
        }
      }

      // Generate owner 1099-MISCs
      for (const o of owners) {
        try {
          const { error } = await supabase.functions.invoke('generate-1099', {
            body: {
              tax_year,
              form_type: '1099-MISC',
              recipient_type: 'owner',
              recipient_id: o.owner_id,
            },
          })
          if (!error) results.success++
          else results.failed++
        } catch {
          results.failed++
        }
      }

      return results
    },
    onSuccess: (results) => {
      invalidateAll()
      if (results.failed === 0) {
        toast.success(`All ${results.success} forms generated successfully`)
      } else {
        toast.warning(`${results.success} generated, ${results.failed} failed`)
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const voidForm = useMutation({
    mutationFn: async (id: string) => {
      const { data: user } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('tax_form_1099s')
        .update({
          status: 'voided',
          voided_at: new Date().toISOString(),
          voided_by: user.user?.id,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Form voided')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const markSent = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tax_form_1099s')
        .update({ status: 'sent' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Form marked as sent')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const downloadForm = async (storagePath: string) => {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(storagePath, 3600)
    if (error) {
      toast.error('Failed to generate download link')
      return null
    }
    return data.signedUrl
  }

  return {
    updatePayerSettings,
    generateForm,
    generateAllForms,
    voidForm,
    markSent,
    downloadForm,
  }
}
