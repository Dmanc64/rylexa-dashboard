'use client'

import { useState, useMemo } from 'react'
import { useAuditLog, AuditFilters, AuditEntry } from '@/hooks/useAuditLog'
import {
  ScrollText, Search, Filter, ChevronLeft, ChevronRight,
  Loader2, Plus, Pencil, Trash2, X, ChevronDown
} from 'lucide-react'

const AUDITED_TABLES = [
  'leases', 'work_orders', 'tenants', 'units', 'properties',
  'vendors', 'profiles', 'accounting', 'transactions',
  'vendor_bids', 'vendor_invoices',
]

const ACTION_COLORS: Record<string, string> = {
  INSERT: 'bg-emerald-100 text-emerald-700',
  UPDATE: 'bg-amber-100 text-amber-700',
  DELETE: 'bg-red-100 text-red-700',
}

const ACTION_ICONS: Record<string, typeof Plus> = {
  INSERT: Plus,
  UPDATE: Pencil,
  DELETE: Trash2,
}

function formatTableName(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatTimestamp(ts: string) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function ChangeSummary({ entry }: { entry: AuditEntry }) {
  if (entry.action === 'INSERT' && entry.new_values) {
    const keys = Object.keys(entry.new_values).filter(
      (k) => !['id', 'created_at', 'updated_at'].includes(k)
    )
    return (
      <span className="text-xs text-slate-500">
        Created with {keys.length} field{keys.length !== 1 ? 's' : ''}
      </span>
    )
  }

  if (entry.action === 'UPDATE' && entry.old_values && entry.new_values) {
    const keys = Object.keys(entry.new_values)
    return (
      <span className="text-xs text-slate-500">
        Changed: {keys.join(', ')}
      </span>
    )
  }

  if (entry.action === 'DELETE') {
    return <span className="text-xs text-slate-500">Record deleted</span>
  }

  return <span className="text-xs text-slate-400">—</span>
}

function DiffViewer({ entry }: { entry: AuditEntry }) {
  if (entry.action === 'INSERT' && entry.new_values) {
    return (
      <div className="space-y-1">
        {Object.entries(entry.new_values).map(([key, val]) => (
          <div key={key} className="flex gap-2 text-xs">
            <span className="font-mono font-bold text-slate-600 min-w-[140px]">{key}</span>
            <span className="text-emerald-700 font-mono break-all">
              {typeof val === 'object' ? JSON.stringify(val) : String(val ?? 'null')}
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (entry.action === 'UPDATE' && entry.old_values && entry.new_values) {
    return (
      <div className="space-y-2">
        {Object.keys(entry.new_values).map((key) => (
          <div key={key} className="text-xs">
            <span className="font-mono font-bold text-slate-600">{key}</span>
            <div className="ml-4 space-y-0.5">
              <div className="flex gap-2">
                <span className="text-red-500 font-mono">−</span>
                <span className="text-red-600 font-mono break-all">
                  {typeof entry.old_values![key] === 'object'
                    ? JSON.stringify(entry.old_values![key])
                    : String(entry.old_values![key] ?? 'null')}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-emerald-500 font-mono">+</span>
                <span className="text-emerald-600 font-mono break-all">
                  {typeof entry.new_values![key] === 'object'
                    ? JSON.stringify(entry.new_values![key])
                    : String(entry.new_values![key] ?? 'null')}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (entry.action === 'DELETE' && entry.old_values) {
    return (
      <div className="space-y-1">
        {Object.entries(entry.old_values).map(([key, val]) => (
          <div key={key} className="flex gap-2 text-xs">
            <span className="font-mono font-bold text-slate-600 min-w-[140px]">{key}</span>
            <span className="text-red-600 font-mono break-all line-through">
              {typeof val === 'object' ? JSON.stringify(val) : String(val ?? 'null')}
            </span>
          </div>
        ))}
      </div>
    )
  }

  return null
}

export default function AuditLogPage() {
  const [page, setPage] = useState(0)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [filters, setFilters] = useState<AuditFilters>({})
  const [draftEmail, setDraftEmail] = useState('')

  // Debounced filters for the query
  const activeFilters = useMemo(() => ({
    ...filters,
    user_email: draftEmail.length >= 2 ? draftEmail : undefined,
  }), [filters, draftEmail])

  const { logs, loading, totalCount, pageSize } = useAuditLog(activeFilters, page)

  const totalPages = Math.ceil(totalCount / pageSize)

  const clearFilters = () => {
    setFilters({})
    setDraftEmail('')
    setPage(0)
  }

  const hasActiveFilters = filters.table_name || filters.action || filters.date_from || filters.date_to || draftEmail.length >= 2

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* HEADER */}
        <header>
          <h1 className="text-4xl font-black tracking-tight italic text-slate-900">Audit Trail</h1>
          <p className="text-slate-500 font-medium">
            Every change across the system, automatically captured.
          </p>
        </header>

        {/* FILTERS */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Filter size={16} className="text-slate-400" />
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Filters</span>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="ml-auto text-[10px] font-bold uppercase tracking-widest text-red-500 hover:text-red-700 flex items-center gap-1"
              >
                <X size={12} /> Clear All
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Table filter */}
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Table</label>
              <div className="relative">
                <select
                  value={filters.table_name || ''}
                  onChange={(e) => { setFilters({ ...filters, table_name: e.target.value || undefined }); setPage(0) }}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold appearance-none pr-8"
                >
                  <option value="">All Tables</option>
                  {AUDITED_TABLES.map((t) => (
                    <option key={t} value={t}>{formatTableName(t)}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Action filter */}
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Action</label>
              <div className="relative">
                <select
                  value={filters.action || ''}
                  onChange={(e) => { setFilters({ ...filters, action: e.target.value || undefined }); setPage(0) }}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold appearance-none pr-8"
                >
                  <option value="">All Actions</option>
                  <option value="INSERT">Insert</option>
                  <option value="UPDATE">Update</option>
                  <option value="DELETE">Delete</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* User email search */}
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">User</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={draftEmail}
                  onChange={(e) => { setDraftEmail(e.target.value); setPage(0) }}
                  placeholder="Search by email..."
                  className="w-full p-3 pl-9 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
                />
              </div>
            </div>

            {/* Date from */}
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">From</label>
              <input
                type="date"
                value={filters.date_from || ''}
                onChange={(e) => { setFilters({ ...filters, date_from: e.target.value || undefined }); setPage(0) }}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
              />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest">To</label>
              <input
                type="date"
                value={filters.date_to || ''}
                onChange={(e) => { setFilters({ ...filters, date_to: e.target.value || undefined }); setPage(0) }}
                className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold"
              />
            </div>
          </div>
        </div>

        {/* RESULTS */}
        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">

          {/* Count bar */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScrollText size={16} className="text-slate-400" />
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {loading ? 'Loading...' : `${totalCount.toLocaleString()} record${totalCount !== 1 ? 's' : ''}`}
              </span>
            </div>
            {totalPages > 1 && (
              <span className="text-[10px] font-bold text-slate-400">
                Page {page + 1} of {totalPages}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-blue-500" size={32} />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <ScrollText size={40} className="mb-3 opacity-40" />
              <p className="font-bold text-sm">No audit records found</p>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="mt-2 text-xs font-bold text-blue-500 hover:text-blue-700"
                >
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {logs.map((entry) => {
                const isExpanded = expandedRow === entry.id
                const ActionIcon = ACTION_ICONS[entry.action] || Pencil

                return (
                  <div key={entry.id}>
                    <button
                      onClick={() => setExpandedRow(isExpanded ? null : entry.id)}
                      className="w-full text-left px-6 py-4 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        {/* Timestamp */}
                        <span className="text-xs font-mono text-slate-400 min-w-[160px] shrink-0">
                          {formatTimestamp(entry.created_at)}
                        </span>

                        {/* Action badge */}
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider ${ACTION_COLORS[entry.action]}`}>
                          <ActionIcon size={10} />
                          {entry.action}
                        </span>

                        {/* Table name */}
                        <span className="text-xs font-bold text-slate-700 min-w-[120px]">
                          {formatTableName(entry.table_name)}
                        </span>

                        {/* User */}
                        <span className="text-xs text-slate-500 min-w-[180px] truncate">
                          {entry.user_email || 'System'}
                          {entry.user_role && (
                            <span className="ml-1.5 text-[9px] font-bold text-slate-400 uppercase">
                              ({entry.user_role})
                            </span>
                          )}
                        </span>

                        {/* Change summary */}
                        <div className="flex-1 truncate">
                          <ChangeSummary entry={entry} />
                        </div>

                        {/* Record ID */}
                        <span className="text-[10px] font-mono text-slate-300 hidden xl:block">
                          {entry.record_id?.slice(0, 8)}...
                        </span>

                        {/* Expand indicator */}
                        <ChevronDown
                          size={14}
                          className={`text-slate-300 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        />
                      </div>
                    </button>

                    {/* Expanded diff view */}
                    {isExpanded && (
                      <div className="px-6 pb-4">
                        <div className="bg-slate-50 rounded-2xl border border-slate-200 p-4 ml-[176px]">
                          <div className="flex items-center gap-2 mb-3">
                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              {entry.action === 'UPDATE' ? 'Changes' : entry.action === 'INSERT' ? 'New Record' : 'Deleted Record'}
                            </span>
                            <span className="text-[10px] font-mono text-slate-300">
                              ID: {entry.record_id}
                            </span>
                          </div>
                          <DiffViewer entry={entry} />
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* PAGINATION */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} /> Previous
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  let pageNum: number
                  if (totalPages <= 7) {
                    pageNum = i
                  } else if (page < 3) {
                    pageNum = i
                  } else if (page > totalPages - 4) {
                    pageNum = totalPages - 7 + i
                  } else {
                    pageNum = page - 3 + i
                  }
                  return (
                    <button
                      key={pageNum}
                      onClick={() => setPage(pageNum)}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                        page === pageNum
                          ? 'bg-slate-900 text-white'
                          : 'text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {pageNum + 1}
                    </button>
                  )
                })}
              </div>

              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1}
                className="flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
