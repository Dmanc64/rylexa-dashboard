'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { Search, Wrench, Ban, Gavel, Circle, Sparkles } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import VendorPerformanceBadge from '@/components/VendorPerformanceBadge'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  ticketId: string
  ticketTitle: string
  /**
   * Optional — when set, the modal pins this vendor at the top as an
   * AI-recommended pick (sourced from work_orders.ai_suggested_vendor_id
   * set by the triage-work-order edge function). One-click assignable.
   */
  suggestedVendorId?: string | null
}

type Vendor = {
  id: string
  company_name: string | null
  contact_name: string | null
  trade_type: string | null
  do_not_use: boolean
}

type VendorPerf = {
  vendor_id: string
  avg_rating: number | null
  total_completed_jobs: number
  review_count: number
}

type AvailStatus = 'available' | 'busy' | 'unavailable' | 'unknown'

const AVAIL_DOT: Record<AvailStatus, { color: string; label: string }> = {
  available: { color: 'text-emerald-500', label: 'Available now' },
  busy: { color: 'text-yellow-500', label: 'Busy today' },
  unavailable: { color: 'text-red-500', label: 'Unavailable' },
  unknown: { color: 'text-slate-300', label: 'No schedule' },
}

export default function AssignVendorModal({ isOpen, onClose, onSuccess, ticketId, ticketTitle, suggestedVendorId }: Props) {
  const [search, setSearch] = useState('')
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [perfMap, setPerfMap] = useState<Record<string, VendorPerf>>({})
  const [availMap, setAvailMap] = useState<Record<string, AvailStatus>>({})
  const [hasPendingBids, setHasPendingBids] = useState(false)
  const [suggestedVendor, setSuggestedVendor] = useState<Vendor | null>(null)

  // Check for pending bids on this work order
  useEffect(() => {
    if (!isOpen || !ticketId) return
    supabase
      .from('vendor_bids')
      .select('id')
      .eq('work_order_id', ticketId)
      .eq('status', 'Pending')
      .limit(1)
      .then(({ data }) => setHasPendingBids(!!(data && data.length > 0)))
  }, [isOpen, ticketId])

  // Fetch the AI-suggested vendor's full record (+ performance + availability)
  // when the modal opens, so we can pin it as a recommendation.
  useEffect(() => {
    if (!isOpen) return
    if (!suggestedVendorId) {
      setSuggestedVendor(null)
      return
    }
    supabase
      .from('vendors')
      .select('id, company_name, contact_name, trade_type, do_not_use')
      .eq('id', suggestedVendorId)
      .single()
      .then(({ data }) => {
        if (data) {
          setSuggestedVendor(data)
          fetchPerformance([data.id])
          fetchAvailability([data.id])
        } else {
          setSuggestedVendor(null)
        }
      })
  }, [isOpen, suggestedVendorId])

  // 1. Fetch Logic
  const fetchVendors = async (searchTerm: string) => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('vendors')
        .select('id, company_name, contact_name, trade_type, do_not_use')
        .or(`company_name.ilike.%${searchTerm.replace(/[%_,.()"\\\\\\/]/g, '')}%,contact_name.ilike.%${searchTerm.replace(/[%_,.()"\\\\\\/]/g, '')}%,trade_type.ilike.%${searchTerm.replace(/[%_,.()"\\\\\\/]/g, '')}%`)
        .limit(10)

      if (data) {
        setVendors(data)
        const ids = data.map(v => v.id)
        if (ids.length > 0) {
          fetchPerformance(ids)
          fetchAvailability(ids)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const fetchPerformance = async (vendorIds: string[]) => {
    const { data } = await supabase
      .from('vendor_performance_summary')
      .select('vendor_id, avg_rating, total_completed_jobs, review_count')
      .in('vendor_id', vendorIds)
    if (data) {
      const map: Record<string, VendorPerf> = {}
      for (const p of data) map[p.vendor_id] = p as VendorPerf
      setPerfMap(map)
    }
  }

  const fetchAvailability = async (vendorIds: string[]) => {
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const dayOfWeek = today.getDay()
    const now = today.toTimeString().slice(0, 5)

    const [schedRes, blockedRes] = await Promise.all([
      supabase
        .from('vendor_availability')
        .select('vendor_id, start_time, end_time')
        .in('vendor_id', vendorIds)
        .eq('day_of_week', dayOfWeek),
      supabase
        .from('vendor_unavailable_dates')
        .select('vendor_id')
        .in('vendor_id', vendorIds)
        .eq('date', todayStr),
    ])

    const blockedSet = new Set((blockedRes.data || []).map((b: any) => b.vendor_id))
    const schedByVendor: Record<string, { start_time: string; end_time: string }[]> = {}
    for (const s of (schedRes.data || [])) {
      if (!schedByVendor[s.vendor_id]) schedByVendor[s.vendor_id] = []
      schedByVendor[s.vendor_id].push(s)
    }

    const map: Record<string, AvailStatus> = {}
    for (const vid of vendorIds) {
      if (blockedSet.has(vid)) map[vid] = 'unavailable'
      else if (!schedByVendor[vid] || schedByVendor[vid].length === 0) map[vid] = 'unknown'
      else {
        const inSlot = schedByVendor[vid].some(
          sl => now >= sl.start_time.slice(0, 5) && now <= sl.end_time.slice(0, 5)
        )
        map[vid] = inSlot ? 'available' : 'busy'
      }
    }
    setAvailMap(map)
  }

  // 2. Handle Search Input (The "3-Letter Rule")
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearch(val)

    if (val.length >= 3) {
      fetchVendors(val)
    } else {
      setVendors([]) // Clear results if they delete characters
    }
  }

  // 3. Assign Logic
  const assignVendor = async (vendorId: string) => {
    setAssigning(true)
    try {
      const { error } = await supabase
        .from('work_orders')
        .update({
            vendor_id: vendorId,
            status: 'Assigned'
        })
        .eq('id', ticketId)

      if (error) throw error

      // Log assignment to system_activity for admin feed. Look in the
      // search results first, fall back to the pinned AI suggestion so
      // one-click accepts still produce a named toast.
      const assignedVendor =
        vendors.find(v => v.id === vendorId) ||
        (suggestedVendor?.id === vendorId ? suggestedVendor : null)
      const vendorDisplayName = assignedVendor?.company_name || assignedVendor?.contact_name || 'Vendor'

      await supabase.from('system_activity').insert({
        event_type: 'VENDOR_ASSIGNED',
        title: 'Vendor Assigned to Work Order',
        description: `${vendorDisplayName} assigned to: ${ticketTitle}`,
        actor_name: 'Admin',
        related_entity_id: ticketId,
      })

      toast.success(`${vendorDisplayName} assigned successfully`)
      onSuccess()
      onClose()
      setSearch('')
      setVendors([])
    } catch (err) {
      toast.error('Error assigning vendor')
    } finally {
      setAssigning(false)
    }
  }

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title="Assign Vendor" subtitle={`For: ${ticketTitle}`} size="max-w-lg" headerBg="bg-indigo-50" closeBtnColor="text-indigo-400">
        {/* Search Bar */}
        <div className="p-4 border-b shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
            <input
              autoFocus
              className="w-full pl-9 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="Start typing (e.g. 'Plu')..."
              aria-label="Search vendors"
              value={search}
              onChange={handleSearch}
            />
          </div>
        </div>

        {/* Pending Bids Banner */}
        {hasPendingBids && (
          <div className="mx-4 mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-xs text-amber-700 font-medium shrink-0">
            <Gavel className="w-3.5 h-3.5 shrink-0" />
            This work order has pending vendor bids. Assigning directly will bypass the bidding process.
          </div>
        )}

        {/* AI-Suggested Vendor — pinned when no active search */}
        {suggestedVendor && search.length < 3 && (() => {
          const perf = perfMap[suggestedVendor.id]
          const avail = availMap[suggestedVendor.id] || 'unknown'
          const dot = AVAIL_DOT[avail]
          const disabled = suggestedVendor.do_not_use || assigning
          return (
            <div className="mx-4 mt-3 shrink-0">
              <div className="flex items-center gap-1.5 mb-1.5 px-1">
                <Sparkles className="w-3 h-3 text-violet-500" />
                <span className="text-[10px] font-black uppercase tracking-widest text-violet-600">
                  AI Recommended
                </span>
              </div>
              <button
                disabled={disabled}
                onClick={() => assignVendor(suggestedVendor.id)}
                className={`w-full text-left p-3 rounded-lg border-2 flex justify-between items-start group transition
                  ${suggestedVendor.do_not_use
                    ? 'bg-red-50 border-red-200 opacity-75 cursor-not-allowed'
                    : 'bg-gradient-to-r from-violet-50 to-indigo-50 border-violet-200 hover:border-violet-400 hover:shadow-md'
                  }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Circle size={8} className={`${dot.color} fill-current shrink-0`} />
                    <span className="font-bold text-gray-900 truncate">
                      {suggestedVendor.company_name || suggestedVendor.contact_name}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 ml-[18px]">
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Wrench className="w-3 h-3" /> {suggestedVendor.trade_type || 'General'}
                    </span>
                    <span className={`text-[10px] font-medium ${dot.color}`}>{dot.label}</span>
                  </div>
                  {perf && !suggestedVendor.do_not_use && (
                    <div className="mt-1.5 ml-[18px]">
                      <VendorPerformanceBadge
                        avgRating={perf.avg_rating}
                        completedJobs={perf.total_completed_jobs}
                        reviewCount={perf.review_count}
                        compact
                      />
                    </div>
                  )}
                </div>
                {suggestedVendor.do_not_use ? (
                  <span className="text-xs font-bold text-red-600 flex items-center gap-1 shrink-0">
                    <Ban className="w-3 h-3" /> DO NOT USE
                  </span>
                ) : (
                  <div className="text-white bg-violet-600 group-hover:bg-violet-700 px-3 py-1 rounded-full text-xs font-bold transition shrink-0 mt-1 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Assign
                  </div>
                )}
              </button>
              <p className="text-[10px] text-slate-400 mt-1.5 px-1">
                Or search below to pick a different vendor.
              </p>
            </div>
          )
        })()}

        {/* Results List */}
        <div className="overflow-y-auto p-2 space-y-2 flex-1 min-h-[200px]">
          {loading ? (
             <div className="p-4 text-center text-gray-400 animate-pulse">Searching directory...</div>
          ) : vendors.length > 0 ? (
            vendors.map(v => {
              const perf = perfMap[v.id]
              const avail = availMap[v.id] || 'unknown'
              const dot = AVAIL_DOT[avail]
              return (
                <button
                  key={v.id}
                  disabled={v.do_not_use || assigning}
                  onClick={() => assignVendor(v.id)}
                  className={`w-full text-left p-3 rounded-lg border flex justify-between items-start group transition
                    ${v.do_not_use
                        ? 'bg-red-50 border-red-100 opacity-75 cursor-not-allowed'
                        : 'bg-white border-gray-100 hover:border-indigo-300 hover:shadow-sm'
                    }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Circle size={8} className={`${dot.color} fill-current shrink-0`} />
                      <span className="font-bold text-gray-900 truncate">{v.company_name || v.contact_name}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 ml-[18px]">
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Wrench className="w-3 h-3" /> {v.trade_type || 'General'}
                      </span>
                      <span className={`text-[10px] font-medium ${dot.color}`}>{dot.label}</span>
                    </div>
                    {perf && !v.do_not_use && (
                      <div className="mt-1.5 ml-[18px]">
                        <VendorPerformanceBadge
                          avgRating={perf.avg_rating}
                          completedJobs={perf.total_completed_jobs}
                          reviewCount={perf.review_count}
                          compact
                        />
                      </div>
                    )}
                  </div>

                  {v.do_not_use ? (
                    <span className="text-xs font-bold text-red-600 flex items-center gap-1 shrink-0">
                        <Ban className="w-3 h-3" /> DO NOT USE
                    </span>
                  ) : (
                    <div className="opacity-0 group-hover:opacity-100 text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full text-xs font-bold transition shrink-0 mt-1">
                        Assign
                    </div>
                  )}
                </button>
              )
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 text-sm py-8">
                <Search className="w-8 h-8 mb-2 opacity-20" />
                {search.length < 3 ? (
                    <p>Type at least 3 letters to search.</p>
                ) : (
                    <p>No vendors found matching &quot;{search}&quot;.</p>
                )}
            </div>
          )}
        </div>

    </AccessibleModal>
  )
}