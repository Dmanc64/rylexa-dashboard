'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { 
  X, CheckCircle2, AlertTriangle, 
  ArrowRight, Landmark, FileText, 
  History, Loader2, Save
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

interface ReconciliationDrawerProps {
  discrepancy: any
  onClose: () => void
  onResolved: () => void
}

export default function ReconciliationDrawer({ discrepancy, onClose, onResolved }: ReconciliationDrawerProps) {
  const [loading, setLoading] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  // Focus trapping + Escape to close
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'Tab' && drawerRef.current) {
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus() }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus() }
      }
    }
  }, [onClose])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    requestAnimationFrame(() => {
      const firstBtn = drawerRef.current?.querySelector<HTMLElement>('button')
      firstBtn?.focus()
    })
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  const handleResolve = async (mode: 'match_lease' | 'flag_invalid') => {
    setLoading(true)
    try {
      if (mode === 'match_lease') {
        // 1. Update the live unit/lease rent in the database
        // In this logic, we assume the discrepancy contains the unit_id
        const { error: updateError } = await supabase
          .from('units')
          .update({ market_rent: discrepancy.extracted })
          .eq('id', discrepancy.unit_id)

        if (updateError) throw updateError
      }

      // 2. Log the resolution in the Audit Log
      await supabase.from('system_activity').insert({
        event_type: 'FINANCIAL_MOD',
        title: mode === 'match_lease' ? 'Rent Reconciled' : 'Lease Flagged Invalid',
        description: `${mode === 'match_lease' ? 'Updated system rent to' : 'Rejected AI extraction of'} $${discrepancy.extracted} for ${discrepancy.file}`,
        actor_name: 'Admin User'
      })

      onResolved()
      onClose()
    } catch (err) {
      console.error("Resolution Error:", err)
      toast.error("Failed to resolve discrepancy.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-300"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      role="presentation"
    >
      <div ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby="drawer-title" className="w-full max-w-xl bg-white h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-500">

        {/* HEADER */}
        <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <div>
            <h2 id="drawer-title" className="text-2xl font-black italic uppercase tracking-tighter text-slate-900">
              Audit <span className="text-emerald-600">Resolution</span>
            </h2>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Reconcile AI Extraction vs Ledger</p>
          </div>
          <button onClick={onClose} aria-label="Close drawer" className="p-3 hover:bg-slate-200 rounded-2xl transition-all text-slate-400">
            <X size={24} />
          </button>
        </div>

        {/* CONTENT */}
        <div className="flex-1 overflow-y-auto p-8 space-y-10">
          
          {/* COMPARISON CARD */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-6 bg-red-50 rounded-[2rem] border border-red-100">
              <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                <FileText size={12} /> AI Extracted
              </p>
              <p className="text-3xl font-black italic text-red-600">${discrepancy.extracted}</p>
            </div>
            <div className="p-6 bg-slate-900 rounded-[2rem] text-white">
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                <Landmark size={12} className="text-emerald-500" /> System Ledger
              </p>
              <p className="text-3xl font-black italic text-emerald-500">${discrepancy.system}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Asset Context</h3>
            <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center gap-4">
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center text-slate-400 border border-slate-200 shadow-sm">
                <History size={20} />
              </div>
              <div>
                <p className="text-sm font-black text-slate-900 uppercase italic leading-none">{discrepancy.property}</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">Original File: {discrepancy.file}</p>
              </div>
            </div>
          </div>

          <div className="bg-amber-50 p-6 rounded-3xl border border-amber-200 flex items-start gap-4">
            <AlertTriangle className="text-amber-600 shrink-0" size={24} />
            <p className="text-xs font-bold text-amber-900 leading-relaxed italic">
              "Resolution will be logged in the immutable system audit trail. If you select 'Match Lease', the monthly rent for this unit will be updated immediately."
            </p>
          </div>
        </div>

        {/* ACTIONS */}
        <div className="p-8 border-t border-slate-100 bg-white space-y-4">
          <button 
            disabled={loading}
            onClick={() => handleResolve('match_lease')}
            className="w-full py-6 bg-emerald-600 text-white font-black rounded-[2rem] shadow-xl shadow-emerald-900/20 hover:bg-emerald-700 transition-all flex items-center justify-center gap-3"
          >
            {loading ? <Loader2 className="animate-spin" /> : <Save size={20} />}
            UPDATE SYSTEM TO MATCH LEASE
          </button>
          
          <button 
            disabled={loading}
            onClick={() => handleResolve('flag_invalid')}
            className="w-full py-5 bg-white border-2 border-slate-200 text-slate-400 font-black rounded-[2rem] hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-all flex items-center justify-center gap-3"
          >
            <AlertTriangle size={20} />
            FLAG LEASE AS INVALID
          </button>
        </div>
      </div>
    </div>
  )
}