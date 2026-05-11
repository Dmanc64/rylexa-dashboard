'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  Building2, TrendingUp, TrendingDown, DollarSign,
  Banknote, Loader2, Users, BarChart3
} from 'lucide-react'

type OwnerEntity = { id: string; full_name: string; company_name: string | null }

type OwnerDashboardData = {
  owners: OwnerEntity[]                  // one or more entities the user belongs to
  property_count: number
  total_units: number
  occupied_units: number
  total_income: number
  total_expenses: number
  net_operating_income: number
  total_distributed: number
  recent_distributions: { id: string; amount: number; status: string; created_at: string; property_name: string }[]
}

export default function OwnerPortalDashboard() {
  const router = useRouter()
  const [data, setData] = useState<OwnerDashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchDashboard() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // NEW MODEL: a user belongs to one or more owner entities via owner_entity_members.
      // Aggregate financial summary + recent distributions across every entity they belong to.
      const { data: memberships } = await supabase
        .from('owner_entity_members')
        .select('owner_id, owners(id, full_name, company_name)')
        .eq('user_id', user.id)

      const owners: OwnerEntity[] = (memberships ?? [])
        .map((m: any) => m.owners as OwnerEntity)
        .filter(Boolean)

      if (owners.length === 0) {
        setLoading(false)
        return
      }

      const ownerIds = owners.map((o) => o.id)

      // Aggregate property/unit counts and YTD financials from owner_financial_summary
      const { data: summaries } = await supabase
        .from('owner_financial_summary')
        .select('*')
        .in('owner_id', ownerIds)

      const ytd = (summaries ?? []).reduce(
        (acc, s: any) => ({
          property_count:    acc.property_count    + (Number(s.property_count)    || 0),
          total_units:       acc.total_units       + (Number(s.total_units)       || 0),
          occupied_units:    acc.occupied_units    + (Number(s.occupied_units)    || 0),
          ytd_expenses:      acc.ytd_expenses      + (Number(s.total_expenses)    || 0),
          total_distributed: acc.total_distributed + (Number(s.total_distributed) || 0),
        }),
        { property_count: 0, total_units: 0, occupied_units: 0, ytd_expenses: 0, total_distributed: 0 }
      )

      // Property IDs for the active-rent-roll lookup below
      const { data: propRows } = await supabase
        .from('properties')
        .select('id')
        .in('owner_id', ownerIds)
      const propertyIds = (propRows ?? []).map((p: any) => p.id)

      // ── REAL MONTHLY INCOME = sum of active lease rent ──
      // This is the deterministic "rent roll" — it doesn't drift with YTD or
      // include one-off charges. Matches the "Monthly Income" label exactly.
      let monthlyIncome = 0
      if (propertyIds.length > 0) {
        const { data: activeLeases } = await supabase
          .from('leases')
          .select('rent_amount, units!inner(property_id)')
          .eq('status', 'Active')
          .in('units.property_id', propertyIds)
        monthlyIncome = (activeLeases ?? [])
          .reduce((sum, l: any) => sum + (Number(l.rent_amount) || 0), 0)
      }

      // ── REAL MONTHLY EXPENSES ≈ YTD expenses / months elapsed ──
      // Expenses fluctuate month-to-month (insurance hits annually, repairs are
      // bursty). A YTD-divided-by-elapsed approach gives a sensible average that
      // matches what an owner thinks of as "typical monthly burn."
      const now = new Date()
      const monthsElapsed = Math.max(
        1,
        now.getMonth() + (now.getDate() / 30)   // e.g. May 6 ≈ 4.2 months
      )
      const monthlyExpenses = ytd.ytd_expenses / monthsElapsed
      const monthlyNOI = monthlyIncome - monthlyExpenses

      // Recent distributions across all entities
      const { data: distributions } = await supabase
        .from('distributions')
        .select('id, amount, status, created_at, properties(name)')
        .in('owner_id', ownerIds)
        .order('created_at', { ascending: false })
        .limit(5)

      setData({
        owners,
        property_count:        ytd.property_count,
        total_units:           ytd.total_units,
        occupied_units:        ytd.occupied_units,
        total_income:          monthlyIncome,
        total_expenses:        monthlyExpenses,
        net_operating_income:  monthlyNOI,
        total_distributed:     ytd.total_distributed,
        recent_distributions: (distributions ?? []).map((d: any) => ({
          id: d.id,
          amount: Number(d.amount),
          status: d.status,
          created_at: d.created_at,
          property_name: d.properties?.name || 'Unknown',
        })),
      })
      setLoading(false)
    }
    fetchDashboard()
  }, [router])

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-emerald-500" size={40} />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Loading Portfolio...</p>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Users size={48} className="text-slate-300" />
        <p className="text-slate-400 font-bold text-sm">No owner account linked to your profile.</p>
        <p className="text-slate-300 text-xs">Contact your property manager for access.</p>
      </div>
    )
  }

  const occupancyRate = data.total_units > 0 ? Math.round((data.occupied_units / data.total_units) * 100) : 0

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">

      {/* HEADER */}
      <div className="max-w-6xl mx-auto mb-10">
        <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase mb-2">Owner Portal</p>
        <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
          Welcome, <span className="text-emerald-600">
            {data.owners.length === 1
              ? data.owners[0].full_name
              : `Portfolio across ${data.owners.length} entities`}
          </span>
        </h1>
        <p className="text-slate-400 font-bold text-sm mt-1">
          {data.owners
            .map((o) => o.company_name ? `${o.full_name} (${o.company_name})` : o.full_name)
            .join(' • ')}
        </p>
      </div>

      {/* STAT CARDS */}
      <div className="max-w-6xl mx-auto grid grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <StatCard
          icon={Building2}
          label="Properties"
          value={String(data.property_count)}
          sub={`${data.total_units} total units`}
          color="emerald"
        />
        <StatCard
          icon={BarChart3}
          label="Occupancy"
          value={`${occupancyRate}%`}
          sub={`${data.occupied_units} / ${data.total_units} occupied`}
          color={occupancyRate >= 90 ? 'emerald' : 'amber'}
        />
        <StatCard
          icon={TrendingUp}
          label="Monthly Income"
          value={`$${data.total_income.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="Active lease revenue"
          color="emerald"
        />
        <StatCard
          icon={TrendingDown}
          label="Monthly Expenses"
          value={`$${data.total_expenses.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="Operating costs"
          color="red"
        />
      </div>

      {/* NOI + DISTRIBUTIONS ROW */}
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">

        {/* NOI Card */}
        <div className="bg-slate-900 rounded-[2.5rem] p-10 text-white relative overflow-hidden">
          <DollarSign className="absolute -right-6 -bottom-6 text-white/5" size={150} />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Net Operating Income</p>
          <p className={`text-5xl font-black italic tracking-tighter ${data.net_operating_income >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            ${data.net_operating_income.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-slate-500 text-xs font-bold mt-3">Income minus operating expenses</p>
        </div>

        {/* Total Distributed Card */}
        <div className="bg-white border border-slate-200 rounded-[2.5rem] p-10 relative overflow-hidden">
          <Banknote className="absolute -right-6 -bottom-6 text-slate-50" size={150} />
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 mb-2">Total Distributed</p>
          <p className="text-5xl font-black italic tracking-tighter text-slate-900">
            ${data.total_distributed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-slate-400 text-xs font-bold mt-3">Lifetime completed distributions</p>
        </div>
      </div>

      {/* RECENT DISTRIBUTIONS */}
      <div className="max-w-6xl mx-auto">
        <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
          <Banknote size={14} /> Recent Distributions
        </h2>

        {data.recent_distributions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-[2rem] p-10 text-center">
            <p className="text-slate-300 text-sm font-bold">No distributions yet</p>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm">
            <table className="w-full text-left">
              <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-8 py-4">Date</th>
                  <th className="px-8 py-4">Property</th>
                  <th className="px-8 py-4">Amount</th>
                  <th className="px-8 py-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {data.recent_distributions.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-8 py-4 text-xs font-bold text-slate-500">
                      {new Date(d.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-8 py-4 text-sm font-bold text-slate-700">{d.property_name}</td>
                    <td className="px-8 py-4 text-sm font-black text-emerald-600">${d.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className="px-8 py-4 text-right">
                      <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                        d.status === 'Completed' ? 'bg-emerald-50 text-emerald-600' :
                        d.status === 'Pending' ? 'bg-amber-50 text-amber-600' :
                        d.status === 'Processing' ? 'bg-blue-50 text-blue-600' :
                        'bg-red-50 text-red-600'
                      }`}>
                        {d.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color }: {
  icon: any; label: string; value: string; sub: string; color: string
}) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-600 bg-emerald-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    blue: 'text-blue-600 bg-blue-50',
  }
  const classes = colorMap[color] || colorMap.emerald

  return (
    <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${classes}`}>
        <Icon size={20} />
      </div>
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-2xl font-black italic tracking-tighter text-slate-900">{value}</p>
      <p className="text-[10px] font-bold text-slate-300 mt-1">{sub}</p>
    </div>
  )
}
