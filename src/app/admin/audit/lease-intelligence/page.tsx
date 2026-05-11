'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import {
  FileSearch, Upload, AlertCircle, CheckCircle2,
  ShieldAlert, Loader2, ArrowLeft, BrainCircuit,
  FileText, History, Landmark
} from 'lucide-react'
import Link from 'next/link'

export default function LeaseIntelligencePage() {
  const [analyzing, setAnalyzing] = useState(false)
  const [discrepancies, setDiscrepancies] = useState<any[]>([])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setAnalyzing(true)
    try {
      // 1. Upload to Supabase Storage (Leases Bucket)
      const filePath = `audit_queue/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('leases')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      // 2. Trigger the AI Analysis Edge Function (OpenAI GPT-4o Mini)
      const { data, error: aiError } = await supabase.functions.invoke('analyze-lease', {
        body: { file_path: filePath }
      })

      if (aiError) {
        // Extract the actual error message from the edge function response
        let errorMessage = aiError.message
        try {
          const ctx = (aiError as any)?.context
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json()
            errorMessage = body?.error || errorMessage
          }
        } catch { /* ignore extraction error */ }
        throw new Error(errorMessage)
      }

      // 3. Compare AI extraction to System Data
      // Here we fetch the live rent recorded in our units/tenants table
      const systemRecord = { rent: 1400.00 } // This will be dynamic based on your SQL views
      
      if (data.rent_amount !== systemRecord.rent) {
        setDiscrepancies(prev => [{
          type: 'Rent Mismatch',
          file: file.name,
          extracted: data.rent_amount,
          system: systemRecord.rent,
          severity: 'High',
          property: 'Mid-Town Reno Lofts'
        }, ...prev])

        // 4. Log this discrepancy to our System Activity table
        await supabase.functions.invoke('assign-asset', {
          body: { 
            event_type: 'AUDIT_FLAG', 
            title: 'Lease Discrepancy Found', 
            description: `AI detected rent mismatch on ${file.name}` 
          }
        })
      }

    } catch (err: any) {
      console.error("Audit Error:", err)
      toast.error(err?.message || 'Lease analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-10 p-6 animate-in fade-in duration-700">
      
      {/* HEADER */}
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <BrainCircuit className="text-emerald-500" size={28} />
            <h1 className="text-4xl font-black tracking-tight text-slate-900 italic uppercase leading-none">
              Doc<span className="text-emerald-600">Intelligence</span>
            </h1>
          </div>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] uppercase">
            AI-Powered Lease Verification & Audit
          </p>
        </div>
        <div className="flex gap-4">
          <Link href="/admin/audit" className="flex items-center gap-2 text-slate-400 hover:text-slate-900 font-bold text-[10px] uppercase tracking-widest transition-colors">
            <ArrowLeft size={16} /> Audit Logs
          </Link>
        </div>
      </header>

      {/* UPLOAD ZONE */}
      <div className="relative group">
        <input 
          type="file" 
          onChange={handleFileUpload}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
          disabled={analyzing}
        />
        <div className={`p-20 border-2 border-dashed rounded-[3rem] transition-all flex flex-col items-center justify-center gap-6 shadow-2xl relative overflow-hidden
          ${analyzing ? 'bg-slate-900 border-emerald-500' : 'bg-white border-slate-200 group-hover:border-emerald-400 group-hover:bg-emerald-50/10'}
        `}>
          {analyzing ? (
            <>
              <Loader2 className="w-16 h-16 text-emerald-500 animate-spin" />
              <div className="text-center space-y-2">
                <p className="font-black text-white uppercase italic tracking-tighter text-xl">Analyzing Document...</p>
                <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest animate-pulse">AI is reading lease terms</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-20 h-20 bg-slate-900 text-emerald-500 rounded-[2rem] flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform">
                <Upload size={32} />
              </div>
              <div className="text-center">
                <p className="text-xl font-black italic uppercase tracking-tighter">Drop Lease PDF</p>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">AI will extract rent, dates, and security deposits</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* RESULTS FEED */}
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 italic">
            <FileSearch size={16} /> Automated Audit Findings
          </h3>
          <div className="flex items-center gap-2 text-[9px] font-black uppercase text-emerald-600 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100">
            <ShieldAlert size={14} /> SOC2 Compliant Cloud
          </div>
        </div>

        {discrepancies.length === 0 && !analyzing && (
          <div className="p-16 text-center bg-white rounded-[3rem] border border-slate-200 text-slate-400 italic text-sm font-bold">
            All systems nominal. Upload a document to trigger AI verification.
          </div>
        )}

        <div className="grid gap-4">
          {discrepancies.map((item, idx) => (
            <div key={idx} className="bg-white p-8 rounded-[2.5rem] border-l-[12px] border-l-red-500 border border-slate-200 shadow-xl flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex gap-6 items-center flex-1">
                <div className="p-4 bg-red-50 text-red-600 rounded-2xl shrink-0">
                  <AlertCircle size={28} />
                </div>
                <div>
                  <div className="text-xl font-black text-slate-900 italic uppercase tracking-tighter">{item.type}</div>
                  <div className="flex items-center gap-3 mt-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase">{item.property}</p>
                    <span className="w-1 h-1 bg-slate-200 rounded-full" />
                    <p className="text-[10px] font-bold text-slate-500">{item.file}</p>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center gap-10 bg-slate-50 px-8 py-4 rounded-2xl border border-slate-100">
                <div className="text-center">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">AI Extracted</div>
                  <div className="text-xl font-black text-red-600 italic">${item.extracted}</div>
                </div>
                <div className="w-px h-8 bg-slate-200" />
                <div className="text-center">
                  <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Ledger Balance</div>
                  <div className="text-xl font-black text-slate-900 italic">${item.system}</div>
                </div>
                <button className="ml-4 w-12 h-12 bg-slate-900 text-white rounded-xl flex items-center justify-center hover:bg-emerald-600 transition-all shadow-lg">
                  <History size={20} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}