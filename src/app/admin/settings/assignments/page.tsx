'use client'

import React, { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  Link as LinkIcon, Building2, User,
  Home, ArrowLeft, Loader2, CheckCircle2,
  AlertCircle, Search, MapPin, ShieldCheck
} from 'lucide-react'
import Link from 'next/link'

export default function PropertyAssignmentPage() {
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Data State
  const [users, setUsers] = useState<any[]>([])
  const [properties, setProperties] = useState<any[]>([])
  const [units, setUnits] = useState<any[]>([])

  // Selection State
  const [selectedUser, setSelectedUser] = useState('')
  const [selectedProperty, setSelectedProperty] = useState('')
  const [selectedUnit, setSelectedUnit] = useState('')

  useEffect(() => {
    async function loadData() {
      setFetching(true)
      // 1. Fetch Users via the list-users edge function we built
      const { data: userData } = await supabase.functions.invoke('list-users')
      if (userData?.users) setUsers(userData.users)

      // 2. Fetch Properties
      const { data: propData } = await supabase
        .from('properties')
        .select('id, name, city')
        .order('name')
      if (propData) setProperties(propData)

      setFetching(false)
    }
    loadData()
  }, [supabase])

  // Fetch units when property changes
  useEffect(() => {
    async function loadUnits() {
      if (!selectedProperty) {
        setUnits([])
        return
      }
      const { data } = await supabase
        .from('units')
        .select('id, name')
        .eq('property_id', selectedProperty)
        .order('name')
      if (data) setUnits(data)
    }
    loadUnits()
  }, [selectedProperty, supabase])

  const handleAssignment = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      // We update the user metadata using our provision-user logic or a new dedicated function
      // For speed, we'll use a direct metadata update via the admin client logic
      const { error: assignError } = await supabase.functions.invoke('assign-asset', {
        body: { 
          userId: selectedUser, 
          propertyId: selectedProperty, 
          unitId: selectedUnit 
        }
      })

      if (assignError) throw assignError
      setSuccess(true)
    } catch (err: any) {
      setError(err.message || "Assignment failed.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-10 p-6 animate-in fade-in duration-700">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 italic uppercase">Asset <span className="text-emerald-600">Assignment</span></h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">Link Users to Regional Units</p>
        </div>
        <Link href="/admin/settings/users" className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-bold text-[10px] uppercase tracking-widest transition-colors">
          <ArrowLeft size={16} /> Back to Users
        </Link>
      </header>

      <div className="bg-white p-12 rounded-[3rem] border border-slate-200 shadow-2xl">
        {fetching ? (
          <div className="py-20 text-center"><Loader2 className="animate-spin mx-auto text-emerald-500" size={40} /></div>
        ) : (
          <form onSubmit={handleAssignment} className="space-y-10">
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              
              {/* STEP 1: SELECT USER */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2">
                  <User size={14} className="text-emerald-500" /> 1. Select User
                </label>
                <select 
                  required value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}
                  className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all"
                >
                  <option value="">Select an Identity...</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.email} ({u.app_metadata?.role})</option>
                  ))}
                </select>
              </div>

              {/* STEP 2: SELECT PROPERTY */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2">
                  <Building2 size={14} className="text-emerald-500" /> 2. Select Property
                </label>
                <select 
                  required value={selectedProperty} onChange={(e) => setSelectedProperty(e.target.value)}
                  className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all"
                >
                  <option value="">Select an Asset...</option>
                  {properties.map(p => (
                    <option key={p.id} value={p.id}>{p.name} — {p.city}</option>
                  ))}
                </select>
              </div>

              {/* STEP 3: SELECT UNIT (OPTIONAL FOR VENDORS, REQ FOR TENANTS) */}
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-2 flex items-center gap-2">
                  <Home size={14} className="text-emerald-500" /> 3. Assign Unit
                </label>
                <select 
                  value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)}
                  disabled={!selectedProperty}
                  className="w-full p-5 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-sm outline-none focus:ring-4 focus:ring-emerald-500/10 transition-all disabled:opacity-50"
                >
                  <option value="">Full Property Access (Portfolios)</option>
                  {units.map(u => (
                    <option key={u.id} value={u.id}>Unit {u.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-center">
                 <div className="p-8 bg-emerald-50 rounded-[2rem] border border-emerald-100 text-center">
                    <LinkIcon className="text-emerald-600 mx-auto mb-2" size={32} />
                    <p className="text-[10px] font-black text-emerald-700 uppercase leading-tight">Ready to Link Assets</p>
                 </div>
              </div>

            </div>

            <button 
              type="submit"
              disabled={loading || !selectedUser || !selectedProperty}
              className="w-full py-6 bg-slate-900 text-white font-black rounded-2xl shadow-xl hover:bg-emerald-600 active:scale-95 transition-all flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {loading ? <Loader2 className="animate-spin" /> : <ShieldCheck size={20} />}
              {loading ? 'LINKING...' : 'COMPLETE ASSIGNMENT'}
            </button>

            {success && (
              <div className="bg-emerald-50 border border-emerald-200 p-6 rounded-2xl flex items-center gap-4 text-emerald-700 animate-in zoom-in">
                <CheckCircle2 size={24} />
                <p className="font-bold text-sm uppercase italic tracking-tighter">Identity successfully linked to asset.</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 p-6 rounded-2xl flex items-center gap-4 text-red-700">
                <AlertCircle size={24} />
                <p className="font-bold text-sm italic">{error}</p>
              </div>
            )}

          </form>
        )}
      </div>
    </div>
  )
}