'use client'

import { Star } from 'lucide-react'

type Props = {
  avgRating: number | null
  completedJobs: number
  reviewCount: number
  compact?: boolean
}

export default function VendorPerformanceBadge({ avgRating, completedJobs, reviewCount, compact = false }: Props) {
  const ratingColor = avgRating === null ? 'text-slate-400' :
    avgRating >= 4 ? 'text-emerald-500' :
    avgRating >= 3 ? 'text-yellow-500' : 'text-red-500'

  if (compact) {
    return (
      <div className="flex items-center gap-1.5">
        {avgRating !== null ? (
          <>
            <Star size={12} className="text-yellow-400 fill-yellow-400" />
            <span className={`text-xs font-bold ${ratingColor}`}>{avgRating}</span>
          </>
        ) : (
          <span className="text-[10px] text-slate-400">No ratings</span>
        )}
        <span className="text-slate-300">·</span>
        <span className="text-xs font-bold text-slate-400">{completedJobs} jobs</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-3 py-2 border border-slate-100">
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map(i => (
          <Star
            key={i}
            size={12}
            className={avgRating !== null && i <= Math.round(avgRating) ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 text-[10px]">
        {avgRating !== null && (
          <span className={`font-black ${ratingColor}`}>{avgRating}</span>
        )}
        <span className="text-slate-400 font-bold">({reviewCount})</span>
        <span className="text-slate-300">|</span>
        <span className="text-slate-500 font-bold">{completedJobs} completed</span>
      </div>
    </div>
  )
}
