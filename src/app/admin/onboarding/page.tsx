'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import { UserPlus, AlertCircle, CheckCircle2, Search, Loader2 } from 'lucide-react'

export default function TenantIntakePage() {

  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' })
  const [duplicate, setDuplicate] = useState<any>(null)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleActivateResident = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
      toast.error('Please fill in all fields.')
      return
    }
    if (duplicate) {
      toast.error('Duplicate detected. Please resolve before continuing.')
      return
    }

    setSubmitting(true)
    try {
      const { error } = await supabase.from('tenants').insert({
        first_name: form.firstName.trim(),
        last_name: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        status: 'Active',
      })

      if (error) throw error

      toast.success(`${form.firstName} ${form.lastName} activated successfully.`)
      setForm({ firstName: '', lastName: '', email: '' })
    } catch (err: any) {
      toast.error('Activation failed: ' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ANTI-DUPLICATE CHECK
  const checkForDuplicate = async (email: string) => {
    if (email.length < 5) return
    setChecking(true)
    const { data, error } = await supabase
      .from('tenants')
      .select('id, first_name, last_name, email')
      .eq('email', email)
      .maybeSingle()

    if (error) console.error('Duplicate check failed:', error.message)
    setDuplicate(data || null)
    setChecking(false)
  }

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header>
        <h1 className="text-4xl font-black tracking-tight italic">New Resident Intake</h1>
        <p className="text-slate-500 font-medium mt-1">Onboarding for Reno & Carson City portfolios.</p>
      </header>

      {/* DUPLICATE WARNING BOX */}
      {duplicate && (
        <div className="bg-amber-50 border-2 border-amber-200 p-6 rounded-[2rem] flex gap-5 animate-in slide-in-from-top-4">
          <div className="w-12 h-12 bg-amber-500 text-white rounded-2xl flex items-center justify-center shrink-0 shadow-lg">
            <AlertCircle size={24} />
          </div>
          <div className="flex-1">
            <h4 className="font-black text-amber-900 uppercase text-xs tracking-widest">Duplicate Detected</h4>
            <p className="text-sm text-amber-800 mt-1 font-medium">
              <span className="font-black">{duplicate.first_name} {duplicate.last_name}</span> is already in the system with this email.
            </p>
            <div className="flex gap-3 mt-4">
               <button className="px-4 py-2 bg-amber-600 text-white text-[10px] font-black rounded-xl uppercase tracking-widest">View Existing Ledger</button>
               <button onClick={() => setDuplicate(null)} className="px-4 py-2 bg-white text-amber-900 border border-amber-200 text-[10px] font-black rounded-xl uppercase tracking-widest">Ignore & Continue</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-xl space-y-8">
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">First Name</label>
            <input
              value={form.firstName}
              className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-bold"
              onChange={(e) => setForm({...form, firstName: e.target.value})}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Last Name</label>
            <input
              value={form.lastName}
              className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-bold"
              onChange={(e) => setForm({...form, lastName: e.target.value})}
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-slate-400 ml-2">Email Address (Key Identifier)</label>
          <div className="relative">
            <input
              type="email"
              value={form.email}
              className="w-full p-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-bold"
              onBlur={(e) => checkForDuplicate(e.target.value)}
              onChange={(e) => setForm({...form, email: e.target.value})}
            />
            {checking && <Loader2 className="absolute right-4 top-4 animate-spin text-slate-400" size={20} />}
          </div>
        </div>

        <button
          onClick={handleActivateResident}
          disabled={submitting}
          className="w-full py-5 bg-slate-900 text-white font-black rounded-3xl shadow-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 group disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 size={20} className="animate-spin" />
          ) : (
            <UserPlus size={20} className="group-hover:scale-110 transition-transform" />
          )}
          {submitting ? 'ACTIVATING...' : 'ACTIVATE RESIDENT'}
        </button>
      </div>
    </div>
  )
}