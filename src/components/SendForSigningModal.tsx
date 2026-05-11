'use client'

import { useState } from 'react'
import { Loader2, Send, FileText, Download, DollarSign, Calendar, MapPin } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { toast } from 'sonner'
import AccessibleModal from '@/components/AccessibleModal'
import type { LeaseDetail } from '@/hooks/useLeases'

interface SendForSigningModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  lease: LeaseDetail | null
}

export default function SendForSigningModal({
  isOpen, onClose, onSuccess, lease,
}: SendForSigningModalProps) {
  const [sending, setSending] = useState(false)
  const [downloading, setDownloading] = useState(false)

  if (!lease) return null

  const handlePreview = async () => {
    setDownloading(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-lease', {
        body: { lease_id: lease.lease_id },
      })

      if (error) {
        let msg = 'Failed to preview lease'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        toast.error(msg)
        return
      }

      const blob = data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `Lease_Preview_${lease.first_name}_${lease.last_name}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to preview lease PDF')
    } finally {
      setDownloading(false)
    }
  }

  const handleSend = async () => {
    setSending(true)
    try {
      const { error } = await supabase.rpc('send_lease_for_signing', {
        p_lease_id: lease.lease_id,
      })
      if (error) throw error
      toast.success('Lease sent for signing. Tenant has been notified.')
      onSuccess()
    } catch (err: any) {
      toast.error(err.message || 'Failed to send lease for signing')
    } finally {
      setSending(false)
    }
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Send Lease for E-Signing"
      subtitle={`${lease.property_name}, ${lease.unit_name}`}
      size="max-w-lg"
      headerBg="bg-blue-50"
      headerTextColor="text-blue-900"
      closeBtnColor="text-blue-400"
    >
      <div className="p-6 space-y-6">
        {/* Lease Summary Card */}
        <div className="bg-slate-50 rounded-2xl p-5 space-y-3">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            Lease Summary
          </p>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-black text-slate-900">
                {lease.first_name} {lease.last_name}
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-600">
              <MapPin size={14} className="text-slate-400 shrink-0" />
              {lease.property_name} — {lease.unit_name}
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-600">
              <DollarSign size={14} className="text-slate-400 shrink-0" />
              ${lease.rent_amount?.toLocaleString(undefined, { minimumFractionDigits: 2 })} / month
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Calendar size={14} className="text-slate-400 shrink-0" />
              {lease.end_date
                ? `Ends ${new Date(lease.end_date + 'T00:00:00').toLocaleDateString()}`
                : 'Month-to-Month'
              }
            </div>
          </div>
        </div>

        {/* Info box */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-sm text-blue-800 leading-relaxed">
            The tenant will receive a notification and can review and electronically sign the
            lease agreement from their portal. You will be notified when the lease is signed.
          </p>
        </div>

        {/* Preview button */}
        <button
          onClick={handlePreview}
          disabled={downloading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50"
        >
          {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {downloading ? 'Downloading...' : 'Preview Lease PDF'}
        </button>

        {/* Action buttons */}
        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending}
            className="flex-1 px-5 py-2.5 text-sm font-bold text-white bg-blue-600 rounded-xl hover:bg-blue-500 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
          >
            {sending ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send size={16} />
                Send for Signing
              </>
            )}
          </button>
        </div>
      </div>
    </AccessibleModal>
  )
}
