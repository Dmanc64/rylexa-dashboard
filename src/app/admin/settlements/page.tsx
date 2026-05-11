'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import {
  Calculator, Receipt, UserMinus,
  ArrowRight, Download, ShieldCheck,
  AlertCircle, Loader2, Banknote,
  Wrench
} from 'lucide-react'

export default function MoveOutSettlement() {
  const [loading, setLoading] = useState(true)
  const [tenant, setTenant] = useState<any>(null)
  const [deductions, setDeductions] = useState<any[]>([])
  const [processing, setProcessing] = useState(false)

  useEffect(() => {
    async function loadSettlementData() {
      setLoading(true)
      // Fetch tenants with move-out status via leases
      const { data: leaseData, error } = await supabase
        .from('leases')
        .select('id, status, rent_amount, security_deposit, tenants(id, first_name, last_name, email), units(name, properties(name, city))')
        .eq('status', 'Move-Out')
        .limit(1)
        .maybeSingle()

      if (error) {
        console.error('Settlement load error:', error.message)
      }

      if (leaseData) {
        setTenant({
          lease_id: leaseData.id,
          first_name: (leaseData.tenants as any)?.first_name,
          last_name: (leaseData.tenants as any)?.last_name,
          units: leaseData.units,
          security_deposit_held: leaseData.security_deposit || 0,
        })
      }
      setLoading(false)
    }
    loadSettlementData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totalDeductions = deductions.reduce((acc, item) => acc + item.amount, 0)
  const refundAmount = (tenant?.security_deposit_held || 0) - totalDeductions

  return (
    <div className="space-y-10 animate-in fade-in duration-700">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black tracking-tight text-slate-900 italic">Security Settlement</h1>
          <p className="text-slate-500 font-medium mt-1 uppercase text-[10px] tracking-[0.2em]">Final Accounting & Refund Processing</p>
        </div>
        <div className="bg-slate-900 text-white px-6 py-4 rounded-2xl flex items-center gap-3 shadow-xl shadow-slate-200">
           <UserMinus size={20} className="text-emerald-400" />
           <span className="font-black text-sm uppercase tracking-widest">Process Move-Out</span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LEFT: TENANT SUMMARY */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-10 rounded-[2.5rem] border border-slate-200 shadow-sm relative overflow-hidden">
             <div className="absolute top-0 right-0 p-10 opacity-5">
                <Calculator size={120} />
             </div>
             
             <div className="relative z-10 flex flex-col md:flex-row justify-between gap-8">
                <div>
                   <h2 className="text-3xl font-black text-slate-900">{tenant?.first_name} {tenant?.last_name}</h2>
                   <p className="text-slate-400 font-bold uppercase text-xs tracking-widest mt-1">
                      {tenant?.units?.properties?.name} • Unit {tenant?.units?.name}
                   </p>
                </div>
                <div className="text-right">
                   <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deposit Held</p>
                   <p className="text-3xl font-black text-emerald-600">${tenant?.security_deposit_held?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                </div>
             </div>

             <div className="mt-10 pt-10 border-t border-slate-100 space-y-4">
                <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                   <Wrench size={14} /> Flagged Deductions
                </h3>
                
                {/* DEDUCTION ROW EXAMPLE */}
                <div className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
                   <div>
                      <p className="font-bold text-slate-900 text-sm">Professional Carpet Cleaning</p>
                      <p className="text-[10px] font-medium text-slate-400">Based on Move-Out Inspection Flag</p>
                   </div>
                   <p className="font-black text-slate-900">$150.00</p>
                </div>
                
                <div className="flex justify-between items-center p-4 bg-slate-50 rounded-2xl border border-slate-100">
                   <div>
                      <p className="font-bold text-slate-900 text-sm">Drywall Repair (Living Room)</p>
                      <p className="text-[10px] font-medium text-slate-400">Linked to Work Order #1042</p>
                   </div>
                   <p className="font-black text-slate-900">$85.00</p>
                </div>
             </div>
          </div>
        </div>

        {/* RIGHT: FINAL TOTALS */}
        <div className="space-y-6">
          <div className="bg-slate-900 p-10 rounded-[2.5rem] text-white shadow-2xl shadow-slate-900/20">
             <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 mb-8">Final Settlement</h3>
             
             <div className="space-y-4 mb-10">
                <div className="flex justify-between text-sm">
                   <span className="text-slate-400 font-medium">Initial Deposit</span>
                   <span className="font-bold">${tenant?.security_deposit_held?.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                   <span className="text-slate-400 font-medium">Total Deductions</span>
                   <span className="font-bold text-orange-400">-$235.00</span>
                </div>
                <div className="pt-4 border-t border-slate-800 flex justify-between items-end">
                   <span className="text-xs font-black uppercase text-emerald-500">Net Refund</span>
                   <span className="text-4xl font-black italic">${((tenant?.security_deposit_held ?? 0) - 235).toFixed(2)}</span>
                </div>
             </div>

             <button
               onClick={async () => {
                 if (!tenant?.lease_id) return
                 setProcessing(true)
                 try {
                   const { error } = await supabase
                     .from('system_activity')
                     .insert({
                       event_type: 'REFUND_AUTHORIZED',
                       title: `Refund Authorized: ${tenant.first_name} ${tenant.last_name}`,
                       description: `Security deposit refund of $${refundAmount.toFixed(2)} authorized.`,
                       actor_name: 'Admin',
                     })
                   if (error) throw error
                   toast.success(`Refund of $${refundAmount.toFixed(2)} authorized for ${tenant.first_name} ${tenant.last_name}`)
                 } catch (err: any) {
                   toast.error('Refund authorization failed: ' + err.message)
                 } finally {
                   setProcessing(false)
                 }
               }}
               disabled={processing || !tenant}
               className="w-full py-5 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20 disabled:opacity-50"
             >
                {processing ? <Loader2 size={20} className="animate-spin" /> : <Banknote size={20} />}
                {processing ? 'PROCESSING...' : 'AUTHORIZE REFUND'}
             </button>
          </div>

          <div className="bg-white p-8 rounded-[2rem] border border-slate-200 flex items-center gap-4 group cursor-pointer hover:border-blue-200 transition-all">
             <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-all">
                <Download size={20} />
             </div>
             <div>
                <p className="text-xs font-black text-slate-900">Closing Statement.pdf</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Generated for Nevada Compliance</p>
             </div>
          </div>
        </div>
      </div>
    </div>
  )
}