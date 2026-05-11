'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { 
  FileSearch, Upload, AlertCircle, CheckCircle2, 
  FileText, ShieldAlert, Loader2, ArrowRight 
} from 'lucide-react'

export default function LeaseAuditPage() {
  const [analyzing, setAnalyzing] = useState(false)
  const [discrepancies, setDiscrepancies] = useState<any[]>([])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setAnalyzing(true)
    try {
      // 1. Upload to Supabase Storage
      const filePath = `audit_queue/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('leases')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      // 2. Trigger the AI Analysis Edge Function
      const { data, error: aiError } = await supabase.functions.invoke('analyze-lease', {
        body: { file_path: filePath }
      })

      if (aiError) throw aiError

      // 3. Compare AI extraction to a dummy system record
      // In production, you would fetch the lease record by Tenant ID
      const systemRecord = { rent: 1400.00 }
      
      if (data.rent_amount !== systemRecord.rent) {
        setDiscrepancies(prev => [{
          type: 'Rent Mismatch',
          file: file.name,
          extracted: data.rent_amount,
          system: systemRecord.rent,
          severity: 'High'
        }, ...prev])
      }

    } catch (err) {
      console.error("Audit Error:", err)
      toast.error("Analysis failed. See console for details.")
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <header className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black tracking-tight italic">DocIntelligence Audit</h1>
            <p className="text-slate-500 font-medium">Verify lease data against system records using AI.</p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full">
            <ShieldAlert size={14} /> SOC2 Compliant Processing
          </div>
        </header>

        {/* UPLOAD ZONE */}
        <div className="relative group">
          <input 
            type="file" 
            onChange={handleFileUpload}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            disabled={analyzing}
          />
          <div className={`p-16 border-2 border-dashed rounded-3xl transition-all flex flex-col items-center justify-center gap-4
            ${analyzing ? 'bg-slate-100 border-slate-300' : 'bg-white border-slate-200 group-hover:border-blue-400 group-hover:bg-blue-50/30'}
          `}>
            {analyzing ? (
              <>
                <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
                <p className="font-bold text-slate-700 animate-pulse">AI is reading the lease terms...</p>
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-slate-900 text-white rounded-2xl flex items-center justify-center shadow-xl">
                  <Upload size={28} />
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold">Drop Lease PDF Here</p>
                  <p className="text-sm text-slate-400">AI will automatically extract rent and dates.</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* RESULTS FEED */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <FileSearch size={16} /> Audit Findings
          </h3>

          {discrepancies.length === 0 && !analyzing && (
            <div className="p-10 text-center bg-white rounded-3xl border border-slate-200 text-slate-400 italic">
              No discrepancies found. Upload a lease to begin.
            </div>
          )}

          {discrepancies.map((item, idx) => (
            <div key={idx} className="bg-white p-6 rounded-3xl border-l-8 border-l-red-500 border border-slate-200 shadow-sm flex justify-between items-center">
              <div className="flex gap-4 items-center">
                <div className="p-3 bg-red-50 text-red-600 rounded-xl">
                  <AlertCircle size={24} />
                </div>
                <div>
                  <div className="font-black text-slate-900">{item.type}</div>
                  <p className="text-xs text-slate-500">File: {item.file}</p>
                </div>
              </div>
              <div className="flex items-center gap-8">
                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">Extracted</div>
                  <div className="font-bold text-red-600">${item.extracted}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold text-slate-400 uppercase">System</div>
                  <div className="font-bold text-slate-900">${item.system}</div>
                </div>
                <button className="p-3 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition" aria-label="Review discrepancy">
                  <ArrowRight size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}