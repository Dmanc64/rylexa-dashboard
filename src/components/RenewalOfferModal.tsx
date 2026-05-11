'use client'

import { useState, useEffect } from 'react'
import { Loader2, DollarSign, Calendar, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { toast } from 'sonner'
import AccessibleModal from '@/components/AccessibleModal'
import { useLeaseRenewals } from '@/hooks/useLeaseRenewals'
import type { RenewalScore } from '@/hooks/useRenewalScores'

interface RenewalOfferModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  score: RenewalScore | null
}

export default function RenewalOfferModal({ isOpen, onClose, onSuccess, score }: RenewalOfferModalProps) {
  const { createOffer, creatingOffer, generatePdf, generatingPdf } = useLeaseRenewals()
  const [proposedRent, setProposedRent] = useState('')
  const [proposedEndDate, setProposedEndDate] = useState('')
  const [notes, setNotes] = useState('')

  // Pre-fill when score changes
  useEffect(() => {
    if (score) {
      setProposedRent(score.rent_amount?.toString() ?? '')
      // Default: +12 months from current end
      if (score.end_date) {
        const d = new Date(score.end_date + 'T00:00:00')
        d.setFullYear(d.getFullYear() + 1)
        setProposedEndDate(d.toISOString().split('T')[0])
      }
      setNotes('')
    }
  }, [score])

  if (!score) return null

  const currentRent = score.rent_amount ?? 0
  const newRent = parseFloat(proposedRent) || 0
  const rentDiff = newRent - currentRent
  const rentPctChange = currentRent > 0 ? ((rentDiff / currentRent) * 100).toFixed(1) : '0.0'

  const handleSubmit = async () => {
    if (!proposedRent || !proposedEndDate) {
      toast.error('Please fill in all required fields.')
      return
    }

    if (newRent <= 0) {
      toast.error('Proposed rent must be greater than $0.')
      return
    }

    try {
      const renewalId = await createOffer({
        lease_id: score.lease_id,
        proposed_rent: newRent,
        proposed_end_date: proposedEndDate,
        notes: notes.trim() || undefined,
      })

      // Generate the offer PDF in the background
      if (renewalId) {
        try {
          await generatePdf({ renewal_id: renewalId, mode: 'offer' })
        } catch {
          // PDF generation is non-critical — offer was still created
          console.warn('PDF generation failed, but offer was created.')
        }
      }

      onSuccess()
    } catch {
      // Error toast handled by hook
    }
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Send Renewal Offer"
      subtitle={`${score.tenant_name} — ${score.property_name}, ${score.unit_name}`}
      size="max-w-xl"
      headerBg="bg-violet-50"
      headerTextColor="text-violet-900"
      closeBtnColor="text-violet-400"
    >
      <div className="p-6 space-y-6">
        {/* Current lease summary */}
        <div className="bg-slate-50 rounded-2xl p-4 space-y-2">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Current Lease</p>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Rent</p>
              <p className="text-sm font-black text-slate-900">
                ${currentRent.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Expires</p>
              <p className="text-sm font-black text-slate-900">
                {score.end_date ? new Date(score.end_date + 'T00:00:00').toLocaleDateString() : 'N/A'}
              </p>
            </div>
            <div>
              <p className="text-[9px] font-bold text-slate-400 uppercase">Risk Score</p>
              <p className={`text-sm font-black ${
                score.score >= 70 ? 'text-emerald-600' : score.score >= 40 ? 'text-amber-600' : 'text-red-600'
              }`}>
                {score.score}/100 ({score.risk_level})
              </p>
            </div>
          </div>
        </div>

        {/* Proposed rent */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2">
            Proposed Monthly Rent <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <DollarSign size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="number"
              step="0.01"
              min="0"
              value={proposedRent}
              onChange={(e) => setProposedRent(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
              placeholder="1,500.00"
            />
          </div>
          {/* Rent change preview */}
          {newRent > 0 && (
            <div className={`mt-2 flex items-center gap-2 text-xs font-bold ${
              rentDiff > 0 ? 'text-amber-600' : rentDiff < 0 ? 'text-emerald-600' : 'text-slate-500'
            }`}>
              {rentDiff > 0 ? <TrendingUp size={14} /> : rentDiff < 0 ? <TrendingDown size={14} /> : <Minus size={14} />}
              {rentDiff === 0 ? 'No change from current rent' :
                rentDiff > 0 ? `+$${rentDiff.toFixed(2)} (+${rentPctChange}%) increase` :
                `-$${Math.abs(rentDiff).toFixed(2)} (${rentPctChange}%) decrease`
              }
            </div>
          )}
        </div>

        {/* Proposed end date */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2">
            Proposed New End Date <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="date"
              value={proposedEndDate}
              onChange={(e) => setProposedEndDate(e.target.value)}
              min={score.end_date || undefined}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-bold text-slate-700 mb-2">Notes (Optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 resize-none"
            placeholder="Any additional notes for the tenant..."
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-slate-600 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={creatingOffer || generatingPdf || !proposedRent || !proposedEndDate}
            className="px-5 py-2.5 text-sm font-bold text-white bg-violet-600 rounded-xl hover:bg-violet-500 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {creatingOffer || generatingPdf ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {creatingOffer ? 'Creating...' : 'Generating PDF...'}
              </>
            ) : (
              'Send Offer'
            )}
          </button>
        </div>
      </div>
    </AccessibleModal>
  )
}
