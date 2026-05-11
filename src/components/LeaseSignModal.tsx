'use client'

import { useState, useEffect } from 'react'
import { Loader2, Download, CheckCircle2, DollarSign, Calendar, MapPin, PenLine, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { toast } from 'sonner'
import AccessibleModal from '@/components/AccessibleModal'

type PendingSignature = {
  id: string
  lease_id: string
  rent_amount: number
  start_date: string
  end_date: string | null
  property_name: string
  unit_name: string
}

interface LeaseSignModalProps {
  isOpen: boolean
  onClose: () => void
  onSigned: () => void
  signature: PendingSignature | null
  tenantName: string
}

export default function LeaseSignModal({
  isOpen, onClose, onSigned, signature, tenantName,
}: LeaseSignModalProps) {
  const [typedName, setTypedName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [signing, setSigning] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [success, setSuccess] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setTypedName(tenantName || '')
      setAgreed(false)
      setSigning(false)
      setSuccess(false)
    }
  }, [isOpen, tenantName])

  if (!signature) return null

  const handleDownloadLease = async () => {
    setDownloading(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-lease', {
        body: { lease_id: signature.lease_id },
      })

      if (error) {
        toast.error('Failed to download lease')
        return
      }

      const blob = data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Lease_${tenantName.replace(/\s+/g, '_')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed')
    } finally {
      setDownloading(false)
    }
  }

  const handleSign = async () => {
    if (!typedName.trim() || !agreed) return
    setSigning(true)
    try {
      const { data, error } = await supabase.functions.invoke('sign-lease', {
        body: {
          signature_id: signature.id,
          typed_signature: typedName.trim(),
        },
      })

      if (error) {
        let msg = 'Signing failed'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        throw new Error(msg)
      }

      // Download the signed PDF
      const blob = data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Signed_Lease_${tenantName.replace(/\s+/g, '_')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      setSuccess(true)
      setTimeout(() => {
        onSigned()
      }, 3000)
    } catch (err: any) {
      toast.error(err.message || 'Failed to sign lease')
      setSigning(false)
    }
  }

  // ── Success State ──
  if (success) {
    return (
      <AccessibleModal
        isOpen={isOpen}
        onClose={onClose}
        title="Lease Signed"
        size="max-w-md"
        headerBg="bg-emerald-50"
        headerTextColor="text-emerald-900"
      >
        <div className="p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-900">Lease Signed Successfully!</h3>
          <p className="text-slate-500 text-sm">
            Your signed lease agreement has been downloaded and stored securely.
            A copy is available in your Documents section.
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
            <ShieldCheck size={14} className="text-emerald-500" />
            <span>Electronically signed and legally binding</span>
          </div>
        </div>
      </AccessibleModal>
    )
  }

  // ── Main Signing View ──
  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Sign Your Lease Agreement"
      subtitle={`${signature.property_name}, Unit ${signature.unit_name}`}
      size="max-w-xl"
      headerBg="bg-blue-50"
      headerTextColor="text-blue-900"
      closeBtnColor="text-blue-400"
    >
      <div className="p-6 space-y-6">
        {/* Lease Summary */}
        <div className="bg-slate-50 rounded-2xl p-5 space-y-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Lease Details
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Monthly Rent</p>
              <p className="text-lg font-black text-slate-900 flex items-center gap-1">
                <DollarSign size={16} className="text-slate-400" />
                {signature.rent_amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Location</p>
              <p className="text-sm font-bold text-slate-700 flex items-center gap-1">
                <MapPin size={14} className="text-slate-400" />
                {signature.property_name}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Start Date</p>
              <p className="text-sm font-bold text-slate-700 flex items-center gap-1">
                <Calendar size={14} className="text-slate-400" />
                {signature.start_date
                  ? new Date(signature.start_date + 'T00:00:00').toLocaleDateString()
                  : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">End Date</p>
              <p className="text-sm font-bold text-slate-700 flex items-center gap-1">
                <Calendar size={14} className="text-slate-400" />
                {signature.end_date
                  ? new Date(signature.end_date + 'T00:00:00').toLocaleDateString()
                  : 'Month-to-Month'}
              </p>
            </div>
          </div>
        </div>

        {/* Download lease for review */}
        <button
          onClick={handleDownloadLease}
          disabled={downloading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {downloading ? 'Downloading...' : 'Download Lease to Review'}
        </button>

        {/* Signature Section */}
        <div className="space-y-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Your Electronic Signature
          </p>

          {/* Type to sign input */}
          <div className="relative">
            <PenLine size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              placeholder="Type your full legal name"
              className="w-full pl-11 pr-4 py-3 border border-slate-300 rounded-xl text-slate-900 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
            />
          </div>

          {/* Live signature preview */}
          {typedName.trim() && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
                Signature Preview
              </p>
              <p
                className="text-2xl text-blue-900"
                style={{ fontFamily: 'Georgia, "Times New Roman", serif', fontStyle: 'italic' }}
              >
                {typedName}
              </p>
              <div className="mt-2 border-t border-slate-300 pt-1">
                <p className="text-[9px] text-slate-400">Electronic Signature</p>
              </div>
            </div>
          )}
        </div>

        {/* Consent checkbox */}
        <label className="flex items-start gap-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-1 w-5 h-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-slate-600 leading-relaxed">
            I have read the lease agreement in full. By typing my name and clicking
            &quot;Sign Lease&quot;, I am providing my electronic signature, which is legally
            equivalent to a handwritten signature under the federal E-SIGN Act (15 U.S.C. 7001)
            and the Uniform Electronic Transactions Act (UETA).
          </span>
        </label>

        {/* Sign button */}
        <button
          onClick={handleSign}
          disabled={!agreed || !typedName.trim() || signing}
          className="w-full px-5 py-4 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
        >
          {signing ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Signing...
            </>
          ) : (
            <>
              <PenLine size={18} />
              Sign Lease
            </>
          )}
        </button>

        {/* Security footer */}
        <div className="flex items-center justify-center gap-2 text-xs text-slate-400">
          <ShieldCheck size={14} className="text-emerald-500" />
          <span>Your signature is encrypted and an audit trail is maintained.</span>
        </div>
      </div>
    </AccessibleModal>
  )
}
