'use client'

import { useState, useEffect } from 'react'
import { Loader2, Download, CheckCircle2, DollarSign, Calendar, ArrowRight, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import AccessibleModal from '@/components/AccessibleModal'

type PendingRenewal = {
  id: string
  lease_id: string
  proposed_rent: number
  proposed_end_date: string
  notes: string | null
  offer_pdf_path: string | null
  current_rent: number
  current_end_date: string
  property_name: string
  unit_name: string
}

interface RenewalAcceptModalProps {
  isOpen: boolean
  onClose: () => void
  onAccepted: () => void
  renewal: PendingRenewal | null
  tenantName: string
}

export default function RenewalAcceptModal({
  isOpen, onClose, onAccepted, renewal, tenantName
}: RenewalAcceptModalProps) {
  const [agreed, setAgreed] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [showDecline, setShowDecline] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [success, setSuccess] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setAgreed(false)
      setAccepting(false)
      setDeclining(false)
      setDownloading(false)
      setShowDecline(false)
      setDeclineReason('')
      setSuccess(false)
    }
  }, [isOpen])

  if (!renewal) return null

  const rentDiff = renewal.proposed_rent - renewal.current_rent
  const rentPctChange = renewal.current_rent > 0
    ? ((rentDiff / renewal.current_rent) * 100).toFixed(1)
    : '0.0'

  const handleAccept = async () => {
    setAccepting(true)
    try {
      const { data, error } = await supabase.rpc('accept_renewal_offer', {
        p_renewal_id: renewal.id,
        p_ip_address: null,
        p_user_agent: navigator.userAgent,
      })
      if (error) throw error

      // Generate executed PDF in background (fire-and-forget)
      supabase.functions.invoke('generate-renewal-offer', {
        body: { renewal_id: renewal.id, mode: 'executed' },
      }).catch(() => {})

      setSuccess(true)
      setTimeout(() => {
        onAccepted()
      }, 3000)
    } catch (err: any) {
      const msg = err?.message || 'Failed to accept renewal'
      // Show inline error via alert for simplicity in the modal
      setAccepting(false)
      toast.error(msg)
    }
  }

  const handleDecline = async () => {
    setDeclining(true)
    try {
      const { error } = await supabase.rpc('decline_renewal_offer', {
        p_renewal_id: renewal.id,
        p_reason: declineReason.trim() || null,
      })
      if (error) throw error
      onClose()
      onAccepted()
    } catch (err: any) {
      setDeclining(false)
      toast.error(err?.message || 'Failed to decline')
    }
  }

  const handleDownloadPdf = async () => {
    setDownloading(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-renewal-offer', {
        body: { renewal_id: renewal.id, mode: 'offer' },
      })

      if (error) throw new Error('Failed to download')

      const blob = data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Renewal_Offer_${tenantName.replace(/\s+/g, '_')}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download PDF')
    } finally {
      setDownloading(false)
    }
  }

  if (success) {
    return (
      <AccessibleModal
        isOpen={isOpen}
        onClose={onClose}
        title="Renewal Accepted"
        size="max-w-md"
        headerBg="bg-emerald-50"
        headerTextColor="text-emerald-900"
      >
        <div className="p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} />
          </div>
          <h3 className="text-xl font-bold text-slate-900">Lease Renewed!</h3>
          <p className="text-slate-500 text-sm">
            Your new lease is now active. The updated terms take effect on{' '}
            {renewal.current_end_date
              ? new Date(new Date(renewal.current_end_date + 'T00:00:00').getTime() + 86400000).toLocaleDateString()
              : 'your next lease start date'}
            .
          </p>
          <p className="text-slate-400 text-xs">
            A confirmation email will be sent to you shortly.
          </p>
        </div>
      </AccessibleModal>
    )
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Lease Renewal Offer"
      subtitle={`${renewal.property_name}, Unit ${renewal.unit_name}`}
      size="max-w-xl"
      headerBg="bg-violet-50"
      headerTextColor="text-violet-900"
      closeBtnColor="text-violet-400"
    >
      <div className="p-6 space-y-6">
        {/* Terms Comparison */}
        <div className="grid grid-cols-2 gap-4">
          {/* Current */}
          <div className="bg-slate-50 rounded-2xl p-4 space-y-3">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Terms</p>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Monthly Rent</p>
              <p className="text-lg font-black text-slate-900">
                ${renewal.current_rent.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Lease Ends</p>
              <p className="text-sm font-bold text-slate-700">
                {renewal.current_end_date ? new Date(renewal.current_end_date + 'T00:00:00').toLocaleDateString() : 'N/A'}
              </p>
            </div>
          </div>

          {/* Proposed */}
          <div className="bg-violet-50 rounded-2xl p-4 space-y-3 border border-violet-200">
            <p className="text-[10px] font-black text-violet-600 uppercase tracking-widest">Proposed Terms</p>
            <div>
              <p className="text-[9px] font-bold text-violet-400 uppercase">New Monthly Rent</p>
              <p className="text-lg font-black text-violet-900">
                ${renewal.proposed_rent.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
              {rentDiff !== 0 && (
                <p className={`text-[10px] font-bold ${rentDiff > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                  {rentDiff > 0 ? '+' : ''}{rentDiff.toFixed(2)} ({rentPctChange}%)
                </p>
              )}
            </div>
            <div>
              <p className="text-[9px] font-bold text-violet-400 uppercase">New End Date</p>
              <p className="text-sm font-bold text-violet-700">
                {new Date(renewal.proposed_end_date + 'T00:00:00').toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>

        {/* Notes */}
        {renewal.notes && (
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">Note from Management</p>
            <p className="text-sm text-blue-800">{renewal.notes}</p>
          </div>
        )}

        {/* Download PDF */}
        <button
          onClick={handleDownloadPdf}
          disabled={downloading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {downloading ? 'Downloading...' : 'Download Offer PDF'}
        </button>

        {/* Decline section */}
        {showDecline ? (
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 space-y-3">
            <p className="text-sm font-bold text-red-700">Are you sure you want to decline?</p>
            <textarea
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              placeholder="Reason for declining (optional)..."
              rows={2}
              className="w-full px-3 py-2 border border-red-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-red-500/20 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowDecline(false)}
                className="px-4 py-2 text-sm font-bold text-slate-600 bg-white rounded-lg hover:bg-slate-50 border border-slate-200"
              >
                Back
              </button>
              <button
                onClick={handleDecline}
                disabled={declining}
                className="px-4 py-2 text-sm font-bold text-white bg-red-600 rounded-lg hover:bg-red-500 disabled:opacity-50 flex items-center gap-2"
              >
                {declining ? <Loader2 size={14} className="animate-spin" /> : null}
                Confirm Decline
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Agreement checkbox */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
              />
              <span className="text-sm text-slate-600 leading-relaxed">
                I have read and agree to the renewed lease terms above. I understand that
                by clicking &quot;Accept &amp; Sign&quot;, I am providing my digital signature,
                which is legally equivalent to a handwritten signature.
              </span>
            </label>

            {/* Action buttons */}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowDecline(true)}
                className="px-5 py-2.5 text-sm font-bold text-red-600 bg-red-50 rounded-xl hover:bg-red-100 transition-colors"
              >
                Decline
              </button>
              <button
                onClick={handleAccept}
                disabled={!agreed || accepting}
                className="flex-1 px-5 py-2.5 text-sm font-bold text-white bg-violet-600 rounded-xl hover:bg-violet-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {accepting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    Accept &amp; Sign
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </AccessibleModal>
  )
}
