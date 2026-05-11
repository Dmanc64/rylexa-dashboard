'use client'

import React, { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  Building2, MapPin, Users, Wrench,
  ArrowLeft, Landmark, TrendingUp, AlertCircle,
  ChevronRight, BadgeDollarSign, Loader2, Users2,
  Zap, Pencil, Check, X
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { toast } from 'sonner'
import PropertyEditModal from '@/components/PropertyEditModal'
import NewLeaseModal from '@/components/NewLeaseModal'

export default function PropertyDetail() {
  const { id } = useParams()
  const [property, setProperty] = useState<any>(null)
  const [units, setUnits] = useState<any[]>([])
  const [owners, setOwners] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [savingOwner, setSavingOwner] = useState(false)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isLeaseOpen, setIsLeaseOpen] = useState(false)
  const [editingFee, setEditingFee] = useState(false)
  const [feeValue, setFeeValue] = useState('')
  const [savingFee, setSavingFee] = useState(false)

  const fetchPropertyData = React.useCallback(async () => {
    const [propRes, unitRes, ownersRes] = await Promise.all([
      supabase.from('properties').select('*, owners(id, full_name, email, company_name)').eq('id', id).single(),
      supabase
        .from('units')
        .select(`
          *,
          leases (
            id,
            rent_amount,
            end_date,
            status,
            tenants (
              id,
              first_name,
              last_name
            )
          )
        `)
        .eq('property_id', id),
      supabase.from('owners').select('id, full_name, company_name').order('full_name'),
    ])

    setProperty(propRes.data)
    setUnits(unitRes.data || [])
    setOwners(ownersRes.data || [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    fetchPropertyData()
  }, [fetchPropertyData])

  const handleOwnerChange = async (ownerId: string) => {
    setSavingOwner(true)
    const { error } = await supabase
      .from('properties')
      .update({ owner_id: ownerId || null })
      .eq('id', id)
    setSavingOwner(false)
    if (error) {
      toast.error('Failed to update owner: ' + error.message)
    } else {
      setProperty((prev: any) => ({
        ...prev,
        owner_id: ownerId || null,
        owners: owners.find((o: any) => o.id === ownerId) || null,
      }))
      toast.success(ownerId ? 'Owner assigned' : 'Owner removed')
    }
  }

  const handleFeeSave = async () => {
    const numVal = parseFloat(feeValue) || 0
    setSavingFee(true)
    const { error } = await supabase
      .from('properties')
      .update({ standard_utility_fee: numVal })
      .eq('id', id)
    setSavingFee(false)
    if (error) {
      toast.error('Failed to save utility fee')
    } else {
      setProperty((prev: any) => ({ ...prev, standard_utility_fee: numVal }))
      toast.success('Utility fee updated')
    }
    setEditingFee(false)
  }

  if (loading) return (
    <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
      <Loader2 className="animate-spin text-emerald-500" size={40} />
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Decrypting Asset Ledger...</p>
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6 md:space-y-8 animate-in fade-in duration-700">

      {/* NAVIGATION & ACTIONS */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <Link href="/admin" className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-black text-[10px] uppercase tracking-widest transition-all">
          <ArrowLeft size={16} /> Back to Portfolio
        </Link>
        <div className="flex gap-3">
          <button
            onClick={() => setIsEditOpen(true)}
            className="px-4 py-2.5 md:px-6 md:py-3 bg-white border border-slate-200 text-slate-900 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 transition-all"
          >
            Edit Asset
          </button>
          <button
            onClick={() => setIsLeaseOpen(true)}
            className="px-4 py-2.5 md:px-6 md:py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-lg"
          >
            New Lease
          </button>
        </div>
      </div>

      {/* HERO SECTION */}
      <div className="bg-white rounded-[2rem] md:rounded-[3rem] border border-slate-200 p-6 md:p-12 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-6 md:gap-8">
          <div>
            <div className="flex items-center gap-3 mb-3 md:mb-4">
              <span className="bg-emerald-500/10 text-emerald-600 text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest border border-emerald-100">
                {property.city}
              </span>
            </div>
            <h1 className="text-3xl md:text-6xl font-black italic uppercase tracking-tighter text-slate-900 leading-none">
              {property.name}
            </h1>
            <p className="text-slate-400 font-bold text-sm md:text-lg mt-2 flex items-center gap-2">
              <MapPin size={16} /> {property.address || 'Reno, NV'}
            </p>
          </div>

          <div className="flex gap-6 md:gap-12">
            <Stat label="Occupancy" value={units.length ? `${Math.round((units.filter((u: any) => u.status === 'Occupied').length / units.length) * 100)}%` : '—'} />
            <Stat label="Units" value={units.length} />
            <Stat label="Monthly Rev" value={`$${(units.reduce((sum: number, u: any) => { const lease = u.leases?.find((l: any) => l.status === 'Active'); return sum + (lease?.rent_amount || 0) }, 0) / 1000).toFixed(1)}k`} highlight />
          </div>
        </div>
        {property.image_url ? (
          <Image src={property.image_url} alt={property.name} fill className="object-cover opacity-10 hidden md:block" sizes="100vw" />
        ) : (
          <Building2 className="absolute -right-10 -bottom-10 text-slate-50 opacity-50 hidden md:block" size={300} />
        )}
      </div>

      {/* UNIT GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">

        {/* LEFT: UNIT LIST */}
        <div className="lg:col-span-2 space-y-4 md:space-y-6">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic flex items-center gap-2">
            <Users size={16} /> Resident Roll & Units
          </h3>

          <div className="bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left min-w-[480px]">
                <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
                  <tr>
                    <th className="px-4 md:px-8 py-4 md:py-5">Unit</th>
                    <th className="px-4 md:px-8 py-4 md:py-5">Resident</th>
                    <th className="px-4 md:px-8 py-4 md:py-5">Rent</th>
                    <th className="px-4 md:px-8 py-4 md:py-5 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {units.map((unit) => {
                    const activeLease = unit.leases?.find((l: any) => l.status === 'Active')
                    const tenant = activeLease?.tenants
                    return (
                    <tr key={unit.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-4 md:px-8 py-4 md:py-6">
                        <p className="font-black text-slate-900 italic uppercase text-sm">{unit.name}</p>
                        <p className="text-[9px] font-bold text-slate-400 uppercase">{unit.status || 'Unknown'}</p>
                      </td>
                      <td className="px-4 md:px-8 py-4 md:py-6">
                        {tenant ? (
                          <p className="text-sm font-bold text-slate-700">{tenant.first_name} {tenant.last_name}</p>
                        ) : (
                          <p className="text-xs text-slate-300 italic font-medium tracking-wide">Vacant / Ready</p>
                        )}
                      </td>
                      <td className="px-4 md:px-8 py-4 md:py-6">
                        <p className="font-black text-slate-900">${activeLease?.rent_amount ?? unit.market_rent ?? '—'}</p>
                      </td>
                      <td className="px-4 md:px-8 py-4 md:py-6 text-right">
                        <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                          tenant ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'
                        }`}>
                          {tenant ? 'Active' : 'Vacant'}
                        </span>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* RIGHT: OPERATIONS SIDEBAR */}
        <div className="space-y-6">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] italic flex items-center gap-2">
            <AlertCircle size={16} /> Asset Alerts
          </h3>
          
          <div className="space-y-4">
            <OperationalCard 
                icon={Wrench} 
                title="Active Tickets" 
                value="3" 
                color="text-amber-600" 
                bg="bg-amber-50" 
                border="border-amber-100" 
            />
            <OperationalCard 
                icon={BadgeDollarSign} 
                title="Arrears" 
                value="$0.00" 
                color="text-emerald-600" 
                bg="bg-emerald-50" 
                border="border-emerald-100" 
            />
          </div>

          {/* Owner Assignment */}
          <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Users2 size={14} className="text-emerald-600" />
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Property Owner</p>
            </div>
            {property.owners ? (
              <div className="mb-4">
                <p className="text-sm font-black text-slate-900 italic uppercase">{property.owners.full_name}</p>
                {property.owners.company_name && (
                  <p className="text-[10px] font-bold text-slate-400 mt-0.5">{property.owners.company_name}</p>
                )}
                <p className="text-[10px] font-bold text-slate-400">{property.owners.email}</p>
              </div>
            ) : (
              <p className="text-xs text-slate-300 italic mb-4">No owner assigned</p>
            )}
            <select
              value={property.owner_id || ''}
              onChange={(e) => handleOwnerChange(e.target.value)}
              disabled={savingOwner}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none focus:ring-2 focus:ring-emerald-500 transition-all appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="">No Owner</option>
              {owners.map((o: any) => (
                <option key={o.id} value={o.id}>
                  {o.full_name}{o.company_name ? ` (${o.company_name})` : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Utility Fee */}
          <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-amber-500" />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Standard Utility Fee</p>
              </div>
              {!editingFee && (
                <button
                  onClick={() => { setFeeValue(String(property.standard_utility_fee || 0)); setEditingFee(true) }}
                  className="text-slate-300 hover:text-emerald-600 transition-colors"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
            {editingFee ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-2.5 text-slate-400 font-bold text-sm">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={feeValue}
                    onChange={e => setFeeValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleFeeSave(); if (e.key === 'Escape') setEditingFee(false) }}
                    autoFocus
                    className="w-full pl-7 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
                <button onClick={handleFeeSave} disabled={savingFee} className="w-8 h-8 bg-emerald-500 text-white rounded-lg flex items-center justify-center hover:bg-emerald-600 transition-colors disabled:opacity-50">
                  <Check size={14} />
                </button>
                <button onClick={() => setEditingFee(false)} className="w-8 h-8 bg-slate-100 text-slate-400 rounded-lg flex items-center justify-center hover:bg-slate-200 transition-colors">
                  <X size={14} />
                </button>
              </div>
            ) : (
              <p className="text-2xl font-black italic text-slate-900">
                ${Number(property.standard_utility_fee || 0).toFixed(2)}
                <span className="text-xs font-bold text-slate-400 ml-1">/mo</span>
              </p>
            )}
          </div>

          <Link href="/admin/finance/statements" className="block">
            <div className="bg-slate-900 rounded-[2rem] p-8 text-white relative overflow-hidden group cursor-pointer hover:bg-slate-800 transition-colors">
              <Landmark className="absolute -right-4 -bottom-4 text-white/5 group-hover:scale-110 transition-transform" size={100} />
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Accounting</p>
              <h4 className="text-xl font-black italic uppercase tracking-tighter mb-4">View Full Ledger</h4>
              <div className="flex items-center gap-2 text-emerald-500 font-black text-[10px] uppercase tracking-widest">
                  Go to Statements <ChevronRight size={14} />
              </div>
            </div>
          </Link>
        </div>
      </div>

      <PropertyEditModal
        isOpen={isEditOpen}
        onClose={() => { setIsEditOpen(false); fetchPropertyData() }}
        property={property}
        onImageUpdated={fetchPropertyData}
      />

      <NewLeaseModal
        isOpen={isLeaseOpen}
        onClose={() => setIsLeaseOpen(false)}
        onSuccess={() => fetchPropertyData()}
        propertyId={id as string}
        propertyName={property?.name}
      />
    </div>
  )
}

function Stat({ label, value, highlight }: any) {
  return (
    <div className="text-left md:text-right">
      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</p>
      <p className={`text-2xl md:text-4xl font-black italic tracking-tighter ${highlight ? 'text-emerald-500' : 'text-slate-900'}`}>
        {value}
      </p>
    </div>
  )
}

function OperationalCard({ icon: Icon, title, value, color, bg, border }: any) {
    return (
        <div className={`${bg} ${border} border p-6 rounded-[2rem] flex items-center justify-between shadow-sm`}>
            <div className="flex items-center gap-4">
                <div className={`w-10 h-10 bg-white rounded-xl flex items-center justify-center ${color} shadow-sm border border-black/5`}>
                    <Icon size={20} />
                </div>
                <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-0.5">{title}</p>
                    <p className={`text-xl font-black italic ${color}`}>{value}</p>
                </div>
            </div>
            <ChevronRight className="text-slate-300" size={18} />
        </div>
    )
}