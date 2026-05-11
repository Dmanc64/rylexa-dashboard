'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  FileText, Download, Calendar,
  Clock, ShieldCheck, Loader2, AlertCircle
} from 'lucide-react'

type Statement = {
  id: string
  lease_id: string
  billing_month: number
  billing_year: number
  period_name: string
  opening_balance: number
  total_charges: number
  total_payments: number
  closing_balance: number
  pdf_path: string | null
  generated_at: string
}

const formatCurrency = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function TenantStatementsPage() {
  const [statements, setStatements] = useState<Statement[]>([])
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    async function fetchStatements() {
      setLoading(true)

      // Get current user's active lease
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      const { data: lease } = await supabase
        .from('leases')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'Active')
        .maybeSingle()

      if (!lease) { setLoading(false); return }

      // Fetch statements for this lease
      const { data } = await supabase
        .from('tenant_statements')
        .select('*')
        .eq('lease_id', lease.id)
        .order('billing_year', { ascending: false })
        .order('billing_month', { ascending: false })

      if (data) setStatements(data)
      setLoading(false)
    }
    fetchStatements()
  }, [])

  const handleDownload = async (stmt: Statement) => {
    if (!stmt.pdf_path) return
    setDownloading(stmt.id)

    try {
      const { data, error } = await supabase.storage
        .from('statements')
        .createSignedUrl(stmt.pdf_path, 60)

      if (error || !data?.signedUrl) {
        throw new Error('Could not generate download link')
      }

      window.open(data.signedUrl, '_blank')
    } catch (err) {
      console.error('Download failed:', err)
    } finally {
      setDownloading(null)
    }
  }

  const latest = statements[0] || null

  return (
    <div className="p-6 md:p-10">
      <div className="max-w-4xl mx-auto space-y-8">

        <header className="flex justify-between items-end">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Monthly Statements</h1>
            <p className="text-slate-500 font-medium text-sm">Download and review your billing history.</p>
          </div>
          <div className="bg-white border border-slate-200 px-4 py-2 rounded-xl flex items-center gap-2 shadow-sm">
            <ShieldCheck size={18} className="text-blue-600" />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Verified Ledger</span>
          </div>
        </header>

        {/* LATEST STATEMENT HERO */}
        {latest ? (
          <div className="bg-slate-900 rounded-3xl p-8 text-white shadow-xl flex flex-col md:flex-row justify-between items-center gap-6 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <FileText size={100} />
            </div>
            <div className="relative z-10">
              <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">Latest Statement</p>
              <h2 className="text-2xl font-black">{latest.period_name} {latest.billing_year} Summary</h2>
              <p className="text-slate-400 text-sm mt-1">
                Generated on {new Date(latest.generated_at).toLocaleDateString()}
              </p>
              <div className="flex gap-6 mt-3">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase">Charges</span>
                  <p className="font-bold text-amber-400">{formatCurrency(latest.total_charges)}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase">Payments</span>
                  <p className="font-bold text-emerald-400">{formatCurrency(latest.total_payments)}</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 uppercase">Balance</span>
                  <p className={`font-black ${latest.closing_balance > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {formatCurrency(latest.closing_balance)}
                  </p>
                </div>
              </div>
            </div>
            {latest.pdf_path && (
              <button
                onClick={() => handleDownload(latest)}
                disabled={downloading === latest.id}
                className="relative z-10 px-8 py-4 bg-blue-600 hover:bg-blue-500 text-white font-black rounded-2xl flex items-center gap-2 transition-all shadow-lg"
              >
                {downloading === latest.id ? (
                  <Loader2 size={20} className="animate-spin" />
                ) : (
                  <Download size={20} />
                )}
                DOWNLOAD PDF
              </button>
            )}
          </div>
        ) : !loading ? (
          <div className="bg-slate-100 rounded-3xl p-12 text-center">
            <AlertCircle size={40} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-400 font-bold">No statements have been generated yet.</p>
            <p className="text-slate-400 text-sm mt-1">Contact management if you believe this is an error.</p>
          </div>
        ) : null}

        {/* STATEMENT ARCHIVE */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 ml-2">
            <Clock size={16} /> Archive History
          </h3>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            {loading ? (
              <div className="p-20 text-center"><Loader2 className="animate-spin mx-auto text-blue-600" /></div>
            ) : statements.length === 0 ? (
              <div className="p-20 text-center text-slate-400 italic">No historical statements found.</div>
            ) : (
              <table className="w-full text-left">
                <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-400">
                  <tr>
                    <th className="px-8 py-4">Billing Period</th>
                    <th className="px-8 py-4">Balance</th>
                    <th className="px-8 py-4">Status</th>
                    <th className="px-8 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statements.map((stmt) => (
                    <tr key={stmt.id} className="hover:bg-slate-50 transition-colors group">
                      <td className="px-8 py-5">
                        <div className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                          {stmt.period_name}
                        </div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase">{stmt.billing_year}</div>
                      </td>
                      <td className="px-8 py-5">
                        <span className={`font-black ${stmt.closing_balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatCurrency(stmt.closing_balance)}
                        </span>
                      </td>
                      <td className="px-8 py-5">
                        <span className="bg-green-50 text-green-700 text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-widest border border-green-100">
                          Posted
                        </span>
                      </td>
                      <td className="px-8 py-5 text-right">
                        {stmt.pdf_path ? (
                          <button
                            onClick={() => handleDownload(stmt)}
                            disabled={downloading === stmt.id}
                            className="p-2 text-slate-300 hover:text-slate-900 transition-colors"
                          >
                            {downloading === stmt.id ? (
                              <Loader2 size={18} className="animate-spin" />
                            ) : (
                              <Download size={18} />
                            )}
                          </button>
                        ) : (
                          <span className="text-slate-300 text-xs">No PDF</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* TAX RECORD NOTE */}
        <div className="p-6 bg-blue-50 border border-blue-100 rounded-2xl flex gap-4">
          <Calendar className="text-blue-600 shrink-0" />
          <p className="text-xs text-blue-900 font-medium leading-relaxed">
            <strong>Tenant Tip:</strong> Statements for the previous year are available for your tax records. Please contact management if you need a full year-end ledger export.
          </p>
        </div>
      </div>
    </div>
  )
}
