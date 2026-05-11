'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import Image from 'next/image'
import { Building2, MapPin, Loader2, Users, TrendingUp, ChevronDown } from 'lucide-react'

type UnitSummary = {
  id: string
  unit_number: string
  status: string
}

type OwnerProperty = {
  id: string
  name: string
  address: string | null
  city: string | null
  image_url: string | null
  total_units: number
  occupied_units: number
  monthly_income: number
  units: UnitSummary[]
}

export default function OwnerPropertiesPage() {
  const router = useRouter()
  const [properties, setProperties] = useState<OwnerProperty[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function fetchProperties() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }

      // Fetch all owner entities the user belongs to (multi-entity model)
      const { data: memberships } = await supabase
        .from('owner_entity_members')
        .select('owner_id')
        .eq('user_id', user.id)

      const ownerIds = (memberships ?? []).map((m: any) => m.owner_id)
      if (ownerIds.length === 0) { setLoading(false); return }

      const { data: props } = await supabase
        .from('properties')
        .select('id, name, address, city, image_url, units(id, name, status, leases(rent_amount, status))')
        .in('owner_id', ownerIds)
        .order('name')

      const mapped: OwnerProperty[] = (props ?? []).map((p: any) => {
        const units = p.units || []
        const occupied = units.filter((u: any) => u.status === 'Occupied').length
        const income = units.reduce((sum: number, u: any) => {
          const activeLease = (u.leases || []).find((l: any) => l.status === 'Active')
          return sum + (activeLease?.rent_amount || 0)
        }, 0)

        return {
          id: p.id,
          name: p.name,
          address: p.address,
          city: p.city,
          image_url: p.image_url || null,
          total_units: units.length,
          occupied_units: occupied,
          monthly_income: income,
          units: units.map((u: any) => ({
            id: u.id,
            unit_number: u.name || u.id,
            status: u.status || 'Unknown',
          })).sort((a: UnitSummary, b: UnitSummary) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true })),
        }
      })

      setProperties(mapped)
      setLoading(false)
    }
    fetchProperties()
  }, [router])

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-emerald-500" size={40} />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Loading Properties...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">

      {/* HEADER */}
      <div className="max-w-6xl mx-auto mb-10">
        <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase mb-2">Owner Portal</p>
        <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
          My <span className="text-emerald-600">Properties</span>
        </h1>
        <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
          {properties.length} {properties.length === 1 ? 'Property' : 'Properties'} in Portfolio
        </p>
      </div>

      {properties.length === 0 ? (
        <div className="max-w-6xl mx-auto py-20 text-center">
          <Building2 size={48} className="text-slate-300 mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">No properties assigned to your account</p>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {properties.map((p) => {
            const occupancy = p.total_units > 0 ? Math.round((p.occupied_units / p.total_units) * 100) : 0
            const isExpanded = expandedCards.has(p.id)
            return (
              <div key={p.id} className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm">
                {/* Top */}
                <div className="flex items-start gap-4 mb-6">
                  <div className="relative w-12 h-12 bg-emerald-50 rounded-2xl overflow-hidden flex items-center justify-center shrink-0">
                    {p.image_url ? (
                      <Image src={p.image_url} alt={p.name} fill className="object-cover" sizes="48px" />
                    ) : (
                      <Building2 size={20} className="text-emerald-600" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-black text-slate-900 italic uppercase leading-tight truncate">
                      {p.name}
                    </h3>
                    {p.city && (
                      <div className="flex items-center gap-1.5 mt-1 text-slate-400">
                        <MapPin size={11} />
                        <span className="text-[10px] font-bold uppercase tracking-wider">{p.city}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-slate-50">
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Units</p>
                    <p className="text-lg font-black italic text-slate-900">{p.total_units}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Occupancy</p>
                    <p className={`text-lg font-black italic ${occupancy >= 90 ? 'text-emerald-600' : 'text-amber-500'}`}>
                      {occupancy}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Revenue</p>
                    <p className="text-lg font-black italic text-emerald-600">
                      ${p.monthly_income.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>

                {/* Unit Breakdown Toggle */}
                {p.units.length > 0 && (
                  <div className="mt-4">
                    <button
                      onClick={() => setExpandedCards(prev => {
                        const next = new Set(prev)
                        if (next.has(p.id)) next.delete(p.id)
                        else next.add(p.id)
                        return next
                      })}
                      className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 transition-all"
                    >
                      <span>Unit Breakdown</span>
                      <ChevronDown size={14} className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>

                    {isExpanded && (
                      <div className="mt-3 space-y-1.5 max-h-60 overflow-y-auto">
                        {p.units.map(u => (
                          <div key={u.id} className="flex items-center justify-between px-4 py-2 bg-slate-50/50 rounded-lg">
                            <span className="text-xs font-bold text-slate-700">{u.unit_number}</span>
                            <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${
                              u.status === 'Occupied'
                                ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                                : 'bg-amber-50 text-amber-600 border border-amber-100'
                            }`}>
                              {u.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
