'use client'

import { useState } from 'react'
import { Star, Loader2 } from 'lucide-react'
import AccessibleModal from './AccessibleModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSubmit: (rating: number, comment: string) => Promise<void>
  vendorName: string
  workOrderTitle: string
}

export default function VendorReviewModal({ isOpen, onClose, onSubmit, vendorName, workOrderTitle }: Props) {
  const [rating, setRating] = useState(0)
  const [hoveredRating, setHoveredRating] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (rating === 0) return
    setSubmitting(true)
    try {
      await onSubmit(rating, comment)
      setRating(0)
      setComment('')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  const displayRating = hoveredRating || rating

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Rate Vendor Performance"
      subtitle={`${vendorName} — ${workOrderTitle}`}
      size="max-w-md"
    >
      <div className="p-6 space-y-6">
        {/* Star Rating */}
        <div>
          <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-3">Rating</p>
          <div className="flex items-center gap-2 justify-center">
            {[1, 2, 3, 4, 5].map(i => (
              <button
                key={i}
                type="button"
                onMouseEnter={() => setHoveredRating(i)}
                onMouseLeave={() => setHoveredRating(0)}
                onClick={() => setRating(i)}
                className="p-1 transition-transform hover:scale-110"
              >
                <Star
                  size={32}
                  className={`transition-colors ${
                    i <= displayRating
                      ? 'text-yellow-400 fill-yellow-400'
                      : 'text-slate-200 hover:text-yellow-200'
                  }`}
                />
              </button>
            ))}
          </div>
          {displayRating > 0 && (
            <p className="text-center text-sm font-bold text-slate-500 mt-2">
              {displayRating === 1 ? 'Poor' :
               displayRating === 2 ? 'Below Average' :
               displayRating === 3 ? 'Average' :
               displayRating === 4 ? 'Good' : 'Excellent'}
            </p>
          )}
        </div>

        {/* Comment */}
        <div>
          <p className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">Comments (Optional)</p>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder="How was the quality of work?"
            className="w-full p-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 border border-slate-200 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={rating === 0 || submitting}
            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {submitting ? <Loader2 className="animate-spin" size={16} /> : <Star size={16} />}
            Submit Review
          </button>
        </div>
      </div>
    </AccessibleModal>
  )
}
