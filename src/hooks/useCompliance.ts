import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──────────────────────────────────────────────────

export type ComplianceAlertSeverity = 'Critical' | 'Warning' | 'Info'
export type CertificationType = 'Initial' | 'Annual' | 'Interim'
export type CertificationStatus = 'Pending' | 'Active' | 'Expired' | 'Superseded'
export type StudentStatus = 'None' | 'Partial' | 'All-Exempt' | 'All-Ineligible'
export type ProgramType = 'LIHTC' | 'Section 8' | 'HOME' | 'USDA/RD' | 'State/Local' | 'Other'

export type ComplianceAlert = {
  id: string
  property_id: string | null
  unit_id: string | null
  tenant_id: string | null
  lease_id: string | null
  certification_id: string | null
  alert_type: string
  severity: ComplianceAlertSeverity
  message: string
  due_date: string | null
  resolved_at: string | null
  resolved_by: string | null
  created_at: string
  // Joined
  property_name?: string
  unit_name?: string
  tenant_name?: string
}

export type IncomeCertification = {
  id: string
  tenant_id: string
  lease_id: string
  certification_date: string
  effective_date: string
  next_recertification_date: string
  annual_income: number
  household_size: number
  ami_percentage_at_cert: number
  certification_type: CertificationType
  status: CertificationStatus
  certified_by: string | null
  notes: string | null
  student_status: StudentStatus
  created_at: string
  updated_at: string
  // Joined
  tenant_name?: string
  property_name?: string
  unit_name?: string
}

export type HouseholdMember = {
  id: string
  certification_id: string
  tenant_id: string | null
  first_name: string
  last_name: string
  relationship: string
  date_of_birth: string | null
  is_full_time_student: boolean
  annual_income: number
  income_source: string | null
}

export type ComplianceDashboardStats = {
  property_id: string
  property_name: string
  program_types: string[]
  is_affordable: boolean
  insurance_required: boolean
  min_liability_amount: number | null
  total_restricted_units: number
  units_with_active_cert: number
  total_insurable_leases: number
  leases_with_active_insurance: number
  critical_alerts: number
  warning_alerts: number
  info_alerts: number
}

// ── Insurance Types ──────────────────────────────────────

export type InsurancePolicyStatus = 'Active' | 'Expired' | 'Pending Review'

export type InsurancePolicy = {
  id: string
  tenant_id: string
  lease_id: string
  property_id: string
  carrier: string
  policy_number: string
  coverage_amount: number
  liability_amount: number
  effective_date: string
  expiration_date: string
  status: InsurancePolicyStatus
  document_id: string | null
  verified_by: string | null
  verified_at: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Joined
  tenant_name?: string
  property_name?: string
  unit_name?: string
}

export type InsuranceFilters = {
  property_id?: string
  status?: InsurancePolicyStatus
}

export type CreateInsurancePolicyPayload = {
  tenant_id: string
  lease_id: string
  property_id: string
  carrier: string
  policy_number: string
  coverage_amount: number
  liability_amount: number
  effective_date: string
  expiration_date: string
  document_id?: string
  notes?: string
}

export type ComplianceFilters = {
  property_id?: string
  severity?: ComplianceAlertSeverity
  resolved?: boolean
}

export type CertificationFilters = {
  property_id?: string
  tenant_id?: string
  status?: CertificationStatus
}

export type CreateCertificationPayload = {
  tenant_id: string
  lease_id: string
  certification_date: string
  effective_date: string
  annual_income: number
  household_size: number
  ami_percentage: number
  certification_type: CertificationType
  notes?: string
  student_status?: StudentStatus
  household_members: HouseholdMemberInput[]
}

export type HouseholdMemberInput = {
  first_name: string
  last_name: string
  relationship: string
  date_of_birth?: string
  is_full_time_student: boolean
  annual_income: number
  income_source?: string
}

// ── Constants ─────────────────────────────────────────────

export const PROGRAM_TYPE_OPTIONS: { value: ProgramType; label: string }[] = [
  { value: 'LIHTC', label: 'LIHTC (Low-Income Housing Tax Credit)' },
  { value: 'Section 8', label: 'Section 8 (Housing Choice Voucher)' },
  { value: 'HOME', label: 'HOME Investment Partnerships' },
  { value: 'USDA/RD', label: 'USDA Rural Development' },
  { value: 'State/Local', label: 'State/Local Program' },
  { value: 'Other', label: 'Other' },
]

export const AMI_PERCENTAGE_OPTIONS = [
  { value: 30, label: '30% AMI' },
  { value: 50, label: '50% AMI' },
  { value: 60, label: '60% AMI' },
  { value: 80, label: '80% AMI' },
]

export const ALERT_TYPE_LABELS: Record<string, string> = {
  RENT_OVER_LIMIT: 'Rent Over Limit',
  MISSING_CERTIFICATION: 'Missing Certification',
  RECERT_OVERDUE: 'Recertification Overdue',
  RECERT_DUE_SOON: 'Recertification Due Soon',
  STUDENT_INELIGIBLE: 'Student Ineligibility',
  MISSING_INSURANCE: 'Missing Insurance',
  INSURANCE_EXPIRED: 'Insurance Expired',
  INSURANCE_EXPIRING: 'Insurance Expiring',
  INSURANCE_BELOW_MINIMUM: 'Below Minimum Coverage',
}

export const INSURANCE_ALERT_TYPES = [
  'MISSING_INSURANCE', 'INSURANCE_EXPIRED', 'INSURANCE_EXPIRING', 'INSURANCE_BELOW_MINIMUM',
]

export const HOUSING_ALERT_TYPES = [
  'RENT_OVER_LIMIT', 'MISSING_CERTIFICATION', 'RECERT_OVERDUE', 'RECERT_DUE_SOON', 'STUDENT_INELIGIBLE',
]

export const SEVERITY_COLORS: Record<ComplianceAlertSeverity, string> = {
  Critical: 'red',
  Warning: 'amber',
  Info: 'emerald',
}

// ── Fetch helpers ─────────────────────────────────────────

async function fetchDashboardStats(): Promise<ComplianceDashboardStats[]> {
  const { data, error } = await supabase
    .from('compliance_dashboard_stats')
    .select('*')

  if (error) throw error
  return (data ?? []) as ComplianceDashboardStats[]
}

async function fetchAlerts(filters: ComplianceFilters): Promise<ComplianceAlert[]> {
  let query = supabase
    .from('compliance_alerts')
    .select(`
      *,
      properties:property_id ( name ),
      units:unit_id ( name ),
      tenants:tenant_id ( first_name, last_name )
    `)
    .order('created_at', { ascending: false })

  if (filters.property_id) {
    query = query.eq('property_id', filters.property_id)
  }
  if (filters.severity) {
    query = query.eq('severity', filters.severity)
  }
  if (filters.resolved === false) {
    query = query.is('resolved_at', null)
  } else if (filters.resolved === true) {
    query = query.not('resolved_at', 'is', null)
  }

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((a: any) => ({
    ...a,
    property_name: a.properties?.name,
    unit_name: a.units?.name,
    tenant_name: a.tenants
      ? `${a.tenants.first_name} ${a.tenants.last_name}`
      : null,
  }))
}

async function fetchCertifications(filters: CertificationFilters): Promise<IncomeCertification[]> {
  let query = supabase
    .from('income_certifications')
    .select(`
      *,
      tenants:tenant_id ( first_name, last_name ),
      leases:lease_id (
        units ( name, properties ( name ) )
      )
    `)
    .order('effective_date', { ascending: false })

  if (filters.property_id) {
    query = query.eq('leases.units.property_id', filters.property_id)
  }
  if (filters.tenant_id) {
    query = query.eq('tenant_id', filters.tenant_id)
  }
  if (filters.status) {
    query = query.eq('status', filters.status)
  }

  const { data, error } = await query
  if (error) throw error

  let results = (data ?? []).map((c: any) => ({
    ...c,
    tenant_name: c.tenants
      ? `${c.tenants.first_name} ${c.tenants.last_name}`
      : null,
    unit_name: c.leases?.units?.name,
    property_name: c.leases?.units?.properties?.name,
  }))

  // Client-side property filter fallback (nested FK filter may not apply on all views)
  if (filters.property_id) {
    results = results.filter((c: any) => c.leases?.units?.properties?.id === filters.property_id)
  }

  return results
}

async function fetchHouseholdMembers(certId: string): Promise<HouseholdMember[]> {
  const { data, error } = await supabase
    .from('household_members')
    .select('*')
    .eq('certification_id', certId)
    .order('created_at')

  if (error) throw error
  return data ?? []
}

async function fetchAffordableProperties() {
  const { data, error } = await supabase
    .from('properties')
    .select('id, name, is_affordable, program_types, insurance_required, min_liability_amount')
    .order('name')

  if (error) throw error
  return data ?? []
}

async function fetchInsurancePolicies(filters: InsuranceFilters): Promise<InsurancePolicy[]> {
  let query = supabase
    .from('insurance_policies')
    .select(`
      *,
      tenants:tenant_id ( first_name, last_name ),
      leases:lease_id (
        units ( name, properties ( name ) )
      )
    `)
    .order('expiration_date', { ascending: true })

  if (filters.property_id) query = query.eq('property_id', filters.property_id)
  if (filters.status) query = query.eq('status', filters.status)

  const { data, error } = await query
  if (error) throw error

  return (data ?? []).map((p: any) => ({
    ...p,
    tenant_name: p.tenants
      ? `${p.tenants.first_name} ${p.tenants.last_name}`
      : null,
    unit_name: p.leases?.units?.name,
    property_name: p.leases?.units?.properties?.name,
  }))
}

// ── Hooks ─────────────────────────────────────────────────

export function useDashboardStats() {
  return useQuery({
    queryKey: ['compliance-dashboard-stats'],
    queryFn: fetchDashboardStats,
    staleTime: 30_000,
  })
}

export function useComplianceAlerts(filters: ComplianceFilters = {}) {
  return useQuery({
    queryKey: ['compliance-alerts', filters],
    queryFn: () => fetchAlerts(filters),
    staleTime: 30_000,
  })
}

export function useCertifications(filters: CertificationFilters = {}) {
  return useQuery({
    queryKey: ['compliance-certifications', filters],
    queryFn: () => fetchCertifications(filters),
    staleTime: 30_000,
  })
}

export function useHouseholdMembers(certId: string | null) {
  return useQuery({
    queryKey: ['household-members', certId],
    queryFn: () => fetchHouseholdMembers(certId!),
    enabled: !!certId,
  })
}

export function useAffordableProperties() {
  return useQuery({
    queryKey: ['affordable-properties'],
    queryFn: fetchAffordableProperties,
    staleTime: 60_000,
  })
}

export function useInsurancePolicies(filters: InsuranceFilters = {}) {
  return useQuery({
    queryKey: ['insurance-policies', filters],
    queryFn: () => fetchInsurancePolicies(filters),
    staleTime: 30_000,
  })
}

// ── Mutations ─────────────────────────────────────────────

export function useComplianceMutations() {
  const qc = useQueryClient()

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['compliance-dashboard-stats'] })
    qc.invalidateQueries({ queryKey: ['compliance-alerts'] })
    qc.invalidateQueries({ queryKey: ['compliance-certifications'] })
    qc.invalidateQueries({ queryKey: ['insurance-policies'] })
    qc.invalidateQueries({ queryKey: ['leases'] })
  }

  const createCertification = useMutation({
    mutationFn: async (payload: CreateCertificationPayload) => {
      const { data, error } = await supabase.rpc('create_income_certification', {
        p_tenant_id: payload.tenant_id,
        p_lease_id: payload.lease_id,
        p_certification_date: payload.certification_date,
        p_effective_date: payload.effective_date,
        p_annual_income: payload.annual_income,
        p_household_size: payload.household_size,
        p_ami_percentage: payload.ami_percentage,
        p_certification_type: payload.certification_type,
        p_notes: payload.notes ?? null,
        p_student_status: payload.student_status ?? 'None',
        p_household_members: JSON.stringify(payload.household_members),
      })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      toast.success('Income certification created')
      invalidateAll()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to create certification'),
  })

  const runComplianceScan = useMutation({
    mutationFn: async (propertyId?: string) => {
      const { data, error } = await supabase.rpc('check_compliance_status', {
        p_property_id: propertyId ?? null,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: (count) => {
      toast.success(`Compliance scan complete — ${count} alert(s) found`)
      invalidateAll()
    },
    onError: (err: any) => toast.error(err.message || 'Compliance scan failed'),
  })

  const resolveAlert = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.rpc('resolve_compliance_alert', {
        p_alert_id: alertId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Alert resolved')
      invalidateAll()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to resolve alert'),
  })

  const updatePropertyProgram = useMutation({
    mutationFn: async ({
      propertyId,
      is_affordable,
      program_types,
      insurance_required,
      min_liability_amount,
    }: {
      propertyId: string
      is_affordable: boolean
      program_types: string[]
      insurance_required?: boolean
      min_liability_amount?: number | null
    }) => {
      const fields: Record<string, any> = { is_affordable, program_types }
      if (insurance_required !== undefined) fields.insurance_required = insurance_required
      if (min_liability_amount !== undefined) fields.min_liability_amount = min_liability_amount
      const { error } = await supabase
        .from('properties')
        .update(fields)
        .eq('id', propertyId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Property compliance settings updated')
      qc.invalidateQueries({ queryKey: ['affordable-properties'] })
      invalidateAll()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update property'),
  })

  const createInsurancePolicy = useMutation({
    mutationFn: async (payload: CreateInsurancePolicyPayload) => {
      const { error } = await supabase
        .from('insurance_policies')
        .insert({
          tenant_id: payload.tenant_id,
          lease_id: payload.lease_id,
          property_id: payload.property_id,
          carrier: payload.carrier,
          policy_number: payload.policy_number,
          coverage_amount: payload.coverage_amount,
          liability_amount: payload.liability_amount,
          effective_date: payload.effective_date,
          expiration_date: payload.expiration_date,
          document_id: payload.document_id ?? null,
          notes: payload.notes ?? null,
          status: 'Pending Review',
        })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Insurance policy recorded — awaiting verification')
      invalidateAll()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to record insurance policy'),
  })

  const verifyInsurancePolicy = useMutation({
    mutationFn: async (policyId: string) => {
      const { error } = await supabase.rpc('verify_insurance_policy', {
        p_policy_id: policyId,
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Insurance policy verified and activated')
      invalidateAll()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to verify policy'),
  })

  const runInsuranceScan = useMutation({
    mutationFn: async (propertyId?: string) => {
      const { data, error } = await supabase.rpc('check_insurance_compliance', {
        p_property_id: propertyId ?? null,
      })
      if (error) throw error
      return data as number
    },
    onSuccess: (count) => {
      toast.success(`Insurance scan complete — ${count} alert(s) found`)
      invalidateAll()
    },
    onError: (err: any) => toast.error(err.message || 'Insurance scan failed'),
  })

  const updateUnitAffordability = useMutation({
    mutationFn: async ({
      unitId,
      ...fields
    }: {
      unitId: string
      bedroom_count?: number | null
      ami_percentage?: number | null
      max_gross_rent?: number | null
      utility_allowance?: number | null
      is_restricted?: boolean
    }) => {
      const { error } = await supabase
        .from('units')
        .update(fields)
        .eq('id', unitId)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Unit affordability updated')
      invalidateAll()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update unit'),
  })

  const bulkUpdateUnits = useMutation({
    mutationFn: async ({
      unitIds,
      fields,
    }: {
      unitIds: string[]
      fields: {
        ami_percentage?: number | null
        utility_allowance?: number | null
        is_restricted?: boolean
        max_gross_rent?: number | null
      }
    }) => {
      const { error } = await supabase
        .from('units')
        .update(fields)
        .in('id', unitIds)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Units updated')
      invalidateAll()
    },
    onError: (err: any) => toast.error(err.message || 'Failed to update units'),
  })

  return {
    createCertification,
    runComplianceScan,
    resolveAlert,
    updatePropertyProgram,
    updateUnitAffordability,
    bulkUpdateUnits,
    createInsurancePolicy,
    verifyInsurancePolicy,
    runInsuranceScan,
  }
}
