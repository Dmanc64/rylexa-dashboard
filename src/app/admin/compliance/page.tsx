'use client'

import { useState, useMemo } from 'react'
import {
  ShieldCheck, Loader2, AlertTriangle, CheckCircle,
  XCircle, RefreshCw, Building2, Plus, Settings2, FileCheck, Gavel
} from 'lucide-react'
import Link from 'next/link'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useDashboardStats,
  useComplianceAlerts,
  useAffordableProperties,
  useComplianceMutations,
  ALERT_TYPE_LABELS,
  INSURANCE_ALERT_TYPES,
  HOUSING_ALERT_TYPES,
  type ComplianceFilters,
  type ComplianceAlert,
} from '@/hooks/useCompliance'
import IncomeCertificationModal from '@/components/IncomeCertificationModal'
import PropertyAffordabilityModal from '@/components/PropertyAffordabilityModal'
import InsurancePolicyModal from '@/components/InsurancePolicyModal'

const SEVERITY_BADGE: Record<string, string> = {
  Critical: 'bg-red-50 text-red-700 border-red-200',
  Warning: 'bg-amber-50 text-amber-700 border-amber-200',
  Info: 'bg-emerald-50 text-emerald-700 border-emerald-200',
}

function formatDate(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

type TabKey = 'housing' | 'insurance'

export default function ComplianceDashboardPage() {
  const { isEnabled } = useFeatureFlags()
  const housingEnabled = isEnabled('affordable_housing')
  const insuranceEnabled = isEnabled('renters_insurance')

  const anyEnabled = housingEnabled || insuranceEnabled
  const bothEnabled = housingEnabled && insuranceEnabled
  const [activeTab, setActiveTab] = useState<TabKey>(housingEnabled ? 'housing' : 'insurance')

  const { data: stats = [], isLoading: statsLoading } = useDashboardStats()
  const { data: properties = [] } = useAffordableProperties()

  const [filterProperty, setFilterProperty] = useState('')
  const [filterSeverity, setFilterSeverity] = useState('')
  const filters: ComplianceFilters = {
    property_id: filterProperty || undefined,
    severity: filterSeverity as any || undefined,
    resolved: false,
  }
  const { data: allAlerts = [], isLoading: alertsLoading } = useComplianceAlerts(filters)

  const { runComplianceScan, resolveAlert, runInsuranceScan } = useComplianceMutations()

  // Modal states
  const [certModalOpen, setCertModalOpen] = useState(false)
  const [policyModalOpen, setPolicyModalOpen] = useState(false)
  const [propModalOpen, setPropModalOpen] = useState(false)
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null)

  // ── Filter stats & alerts by active tab ──
  const housingStats = useMemo(() => stats.filter(p => p.is_affordable), [stats])
  const insuranceStats = useMemo(() => stats.filter(p => p.insurance_required), [stats])
  const tabStats = activeTab === 'housing' ? housingStats : insuranceStats

  const tabAlertTypes = activeTab === 'housing' ? HOUSING_ALERT_TYPES : INSURANCE_ALERT_TYPES
  const tabAlerts = useMemo(
    () => allAlerts.filter(a => tabAlertTypes.includes(a.alert_type)),
    [allAlerts, tabAlertTypes]
  )

  // ── Aggregated stats ──
  // Housing
  const totalRestricted = housingStats.reduce((s, p) => s + Number(p.total_restricted_units), 0)
  const totalCertified = housingStats.reduce((s, p) => s + Number(p.units_with_active_cert), 0)
  // Insurance
  const totalInsurable = insuranceStats.reduce((s, p) => s + Number(p.total_insurable_leases), 0)
  const totalInsured = insuranceStats.reduce((s, p) => s + Number(p.leases_with_active_insurance), 0)
  // Tab-specific alert counts from filtered alerts
  const tabCritical = tabAlerts.filter(a => a.severity === 'Critical').length
  const tabWarning = tabAlerts.filter(a => a.severity === 'Warning').length

  // Properties for filter dropdown
  const tabProperties = activeTab === 'housing'
    ? properties.filter(p => p.is_affordable)
    : properties.filter(p => p.insurance_required)

  if (!anyEnabled) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-slate-400">
        <ShieldCheck size={48} className="mb-4" />
        <p className="text-lg font-semibold">No compliance modules enabled</p>
        <p className="text-sm mt-1">Enable Affordable Housing or Renters Insurance in Settings &rarr; Feature Flags</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 flex items-center gap-2">
            <ShieldCheck size={24} className="text-indigo-600" />
            Compliance Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {activeTab === 'housing'
              ? 'Affordable housing compliance tracking & alerts'
              : 'Renters insurance compliance tracking & alerts'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/compliance/evictions"
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-widest rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Gavel size={14} />
            Evictions
          </Link>
          <button
            onClick={() => setPropModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-widest rounded-full border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Settings2 size={14} />
            Configure Properties
          </button>
          {activeTab === 'housing' && housingEnabled && (
            <button
              onClick={() => setCertModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-widest rounded-full bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
            >
              <Plus size={14} />
              New Certification
            </button>
          )}
          {activeTab === 'insurance' && insuranceEnabled && (
            <button
              onClick={() => setPolicyModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-widest rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
            >
              <Plus size={14} />
              Record Policy
            </button>
          )}
          <button
            onClick={() => {
              if (activeTab === 'housing') runComplianceScan.mutate(filterProperty || undefined)
              else runInsuranceScan.mutate(filterProperty || undefined)
            }}
            disabled={runComplianceScan.isPending || runInsuranceScan.isPending}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold uppercase tracking-widest rounded-full border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors disabled:opacity-50"
          >
            {(runComplianceScan.isPending || runInsuranceScan.isPending) ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Run Scan
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      {bothEnabled && (
        <div className="flex gap-2">
          <button
            onClick={() => { setActiveTab('housing'); setFilterProperty('') }}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-full transition-colors ${
              activeTab === 'housing'
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-indigo-300'
            }`}
          >
            <Building2 size={14} className="inline -mt-0.5 mr-1" />
            Affordable Housing
          </button>
          <button
            onClick={() => { setActiveTab('insurance'); setFilterProperty('') }}
            className={`px-4 py-2 text-xs font-black uppercase tracking-widest rounded-full transition-colors ${
              activeTab === 'insurance'
                ? 'bg-emerald-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:border-emerald-300'
            }`}
          >
            <FileCheck size={14} className="inline -mt-0.5 mr-1" />
            Renters Insurance
          </button>
        </div>
      )}

      {/* ── Summary Cards ── */}
      {statsLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="animate-spin text-slate-400" size={32} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {activeTab === 'housing' ? (
              <>
                <StatCard label="Restricted Units" value={totalRestricted} color="indigo" icon={<Building2 size={18} />} />
                <StatCard
                  label="Units Certified"
                  value={totalCertified}
                  color="emerald"
                  icon={<CheckCircle size={18} />}
                  subtitle={totalRestricted > 0 ? `${Math.round((totalCertified / totalRestricted) * 100)}% coverage` : undefined}
                />
              </>
            ) : (
              <>
                <StatCard label="Insurable Leases" value={totalInsurable} color="indigo" icon={<FileCheck size={18} />} />
                <StatCard
                  label="Leases Insured"
                  value={totalInsured}
                  color="emerald"
                  icon={<CheckCircle size={18} />}
                  subtitle={totalInsurable > 0 ? `${Math.round((totalInsured / totalInsurable) * 100)}% coverage` : undefined}
                />
              </>
            )}
            <StatCard label="Critical Alerts" value={tabCritical} color="red" icon={<XCircle size={18} />} />
            <StatCard label="Warnings" value={tabWarning} color="amber" icon={<AlertTriangle size={18} />} />
          </div>

          {/* ── Property Breakdown ── */}
          {tabStats.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {tabStats.map((p) => (
                <div key={p.property_id} className="bg-white rounded-2xl border border-slate-200 p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold text-slate-900 text-sm">{p.property_name}</h3>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {activeTab === 'housing' && (p.program_types || []).map((pt: string) => (
                          <span key={pt} className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                            {pt}
                          </span>
                        ))}
                        {activeTab === 'insurance' && (
                          <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                            Min. ${Number(p.min_liability_amount ?? 100000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Liability
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => { setSelectedPropertyId(p.property_id); setPropModalOpen(true) }}
                      className="text-slate-400 hover:text-indigo-600 transition-colors"
                    >
                      <Settings2 size={16} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {activeTab === 'housing' ? (
                      <>
                        <div className="bg-slate-50 rounded-xl p-2">
                          <div className="text-lg font-black text-slate-900">{Number(p.total_restricted_units)}</div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Units</div>
                        </div>
                        <div className="bg-emerald-50 rounded-xl p-2">
                          <div className="text-lg font-black text-emerald-700">{Number(p.units_with_active_cert)}</div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Certified</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="bg-slate-50 rounded-xl p-2">
                          <div className="text-lg font-black text-slate-900">{Number(p.total_insurable_leases)}</div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Leases</div>
                        </div>
                        <div className="bg-emerald-50 rounded-xl p-2">
                          <div className="text-lg font-black text-emerald-700">{Number(p.leases_with_active_insurance)}</div>
                          <div className="text-[10px] font-bold uppercase tracking-widest text-emerald-600">Insured</div>
                        </div>
                      </>
                    )}
                    <div className={`rounded-xl p-2 ${Number(p.critical_alerts) > 0 ? 'bg-red-50' : 'bg-slate-50'}`}>
                      <div className={`text-lg font-black ${Number(p.critical_alerts) > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                        {Number(p.critical_alerts)}
                      </div>
                      <div className={`text-[10px] font-bold uppercase tracking-widest ${Number(p.critical_alerts) > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                        Critical
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tabStats.length === 0 && (
            <div className="text-center py-12 bg-white rounded-2xl border border-slate-200">
              <Building2 size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-500 font-medium">
                {activeTab === 'housing'
                  ? 'No affordable housing properties configured'
                  : 'No properties require renters insurance'}
              </p>
              <p className="text-sm text-slate-400 mt-1">Click &ldquo;Configure Properties&rdquo; to set up a property</p>
            </div>
          )}
        </>
      )}

      {/* ── Alerts Section ── */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
          <h2 className="font-black text-sm uppercase tracking-widest text-slate-700 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            Active Alerts
          </h2>
          <div className="flex items-center gap-2 ml-auto">
            <select
              value={filterProperty}
              onChange={(e) => setFilterProperty(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600"
            >
              <option value="">All Properties</option>
              {tabProperties.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={filterSeverity}
              onChange={(e) => setFilterSeverity(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white text-slate-600"
            >
              <option value="">All Severities</option>
              <option value="Critical">Critical</option>
              <option value="Warning">Warning</option>
              <option value="Info">Info</option>
            </select>
          </div>
        </div>

        {alertsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin text-slate-400" size={24} />
          </div>
        ) : tabAlerts.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <CheckCircle size={32} className="mx-auto mb-2 text-emerald-400" />
            <p className="font-medium">No active alerts</p>
            <p className="text-sm mt-1">
              {activeTab === 'housing' ? 'All affordable units are in compliance' : 'All insurance requirements are met'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {tabAlerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onResolve={() => resolveAlert.mutate(alert.id)}
                resolving={resolveAlert.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      <IncomeCertificationModal
        isOpen={certModalOpen}
        onClose={() => setCertModalOpen(false)}
      />
      <InsurancePolicyModal
        isOpen={policyModalOpen}
        onClose={() => setPolicyModalOpen(false)}
      />
      <PropertyAffordabilityModal
        isOpen={propModalOpen}
        onClose={() => { setPropModalOpen(false); setSelectedPropertyId(null) }}
        initialPropertyId={selectedPropertyId}
      />
    </div>
  )
}

// ── Sub-components ──

function StatCard({ label, value, color, icon, subtitle }: {
  label: string; value: number; color: string; icon: React.ReactNode; subtitle?: string
}) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    red: 'bg-red-50 text-red-700',
    amber: 'bg-amber-50 text-amber-700',
  }
  const iconMap: Record<string, string> = {
    indigo: 'text-indigo-500',
    emerald: 'text-emerald-500',
    red: 'text-red-500',
    amber: 'text-amber-500',
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className={iconMap[color]}>{icon}</span>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      </div>
      <div className={`text-3xl font-black ${colorMap[color]?.split(' ')[1] || 'text-slate-900'}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-slate-500 mt-1">{subtitle}</div>
      )}
    </div>
  )
}

function AlertRow({ alert, onResolve, resolving }: {
  alert: ComplianceAlert; onResolve: () => void; resolving: boolean
}) {
  return (
    <div className="px-5 py-3 flex items-center gap-4 hover:bg-slate-50 transition-colors">
      <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest rounded-full border ${SEVERITY_BADGE[alert.severity] || SEVERITY_BADGE.Info}`}>
        {alert.severity}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">{alert.message}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {alert.property_name}
          {alert.tenant_name ? ` — ${alert.tenant_name}` : ''}
          {alert.due_date ? ` | Due: ${formatDate(alert.due_date)}` : ''}
        </p>
      </div>
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap">
        {ALERT_TYPE_LABELS[alert.alert_type] || alert.alert_type}
      </span>
      <button
        onClick={onResolve}
        disabled={resolving}
        className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full border border-emerald-200 text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-50"
      >
        <CheckCircle size={12} />
        Resolve
      </button>
    </div>
  )
}
