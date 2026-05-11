'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'

type PaginationProps = {
  page: number
  totalCount: number
  pageSize: number
  onPageChange: (page: number) => void
}

export default function Pagination({ page, totalCount, pageSize, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const from = page * pageSize + 1
  const to = Math.min((page + 1) * pageSize, totalCount)

  if (totalCount <= pageSize) return null

  return (
    <div className="flex items-center justify-between px-1 py-3">
      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
        {from}–{to} of {totalCount.toLocaleString()}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 0}
          className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} className="text-slate-600" />
        </button>
        <span className="text-xs font-black text-slate-700 px-2">
          {page + 1} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages - 1}
          className="p-1.5 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Next page"
        >
          <ChevronRight size={14} className="text-slate-600" />
        </button>
      </div>
    </div>
  )
}
