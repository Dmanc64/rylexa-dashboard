'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { FileText, Loader2, Download, CheckCircle } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  leaseId: string
  tenantName: string
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export default function GenerateStatementModal({ isOpen, onClose, onSuccess, leaseId, tenantName }: Props) {
  const now = new Date()
  // Default to previous month
  const prevMonth = now.getMonth() === 0 ? 12 : now.getMonth()
  const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()

  const [month, setMonth] = useState(prevMonth)
  const [year, setYear] = useState(prevYear)
  const [loading, setLoading] = useState(false)
  const [generated, setGenerated] = useState(false)

  const handleGenerate = async () => {
    setLoading(true)
    setGenerated(false)

    try {
      const { data, error } = await supabase.functions.invoke('generate-statement', {
        body: {
          lease_id: leaseId,
          billing_month: month,
          billing_year: year,
        },
      })

      if (error) {
        let msg = 'Failed to generate statement'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        throw new Error(msg)
      }

      // Download the PDF
      const blob = data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Statement_${tenantName.replace(/\s+/g, '_')}_${year}-${String(month).padStart(2, '0')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setGenerated(true)
      toast.success(`Statement generated for ${MONTH_NAMES[month - 1]} ${year}`)
      onSuccess()
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setGenerated(false)
    onClose()
  }

  return (
    <AccessibleModal isOpen={isOpen} onClose={handleClose} title="Generate Statement" size="max-w-md">
        <div className="p-6 space-y-6">
          {generated ? (
            <div className="text-center py-6 space-y-4">
              <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto" />
              <div>
                <h4 className="text-lg font-black text-slate-900">Statement Generated!</h4>
                <p className="text-slate-500 text-sm mt-1">
                  {MONTH_NAMES[month - 1]} {year} statement for {tenantName}
                </p>
              </div>
              <p className="text-xs text-slate-400">The PDF has been downloaded to your computer.</p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm text-slate-600 mb-4">
                  Generate a monthly statement PDF for <strong>{tenantName}</strong>.
                  Select the billing period below.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Month</label>
                  <select
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
                    value={month}
                    onChange={(e) => setMonth(Number(e.target.value))}
                  >
                    {MONTH_NAMES.map((name, idx) => (
                      <option key={idx} value={idx + 1}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Year</label>
                  <select
                    className="w-full p-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value))}
                  >
                    {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              <button
                onClick={handleGenerate}
                disabled={loading}
                className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl hover:bg-slate-800 transition shadow-lg flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="animate-spin" size={18} /> : <Download size={18} />}
                {loading ? 'Generating...' : 'Generate & Download PDF'}
              </button>
            </>
          )}

          <button
            onClick={handleClose}
            className="w-full py-2 text-slate-400 hover:text-slate-600 text-sm font-bold transition"
          >
            {generated ? 'Close' : 'Cancel'}
          </button>
        </div>
    </AccessibleModal>
  )
}
