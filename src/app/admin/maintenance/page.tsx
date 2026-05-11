'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { submitMaintenanceUpdate } from '@/actions/maintenance-actions'
import {
  Wrench, Camera, Send, MapPin,
  Loader2, Save, User, Clock, Home, UserCircle, UserPlus, DollarSign, Sparkles, BookOpen, CheckCircle2,
  Gavel, FileText, Star, ExternalLink, ToggleLeft, ToggleRight, CalendarDays, List, RotateCcw,
  Search, X, Filter
} from 'lucide-react'
import { useVendors } from '@/hooks/useVendors'
import { useProperties } from '@/hooks/useProperties'
import Link from 'next/link'
import { toast } from 'sonner'
import Image from 'next/image'
import AssignVendorModal from '@/components/AssignVendorModal'
import VendorReviewModal from '@/components/VendorReviewModal'
import VendorPerformanceBadge from '@/components/VendorPerformanceBadge'
import { compressImage } from '@/lib/compress-image'
import MaintenanceCalendar from '@/components/MaintenanceCalendar'
import ScheduleDatePicker from '@/components/ScheduleDatePicker'
import RecurringMaintenancePanel from '@/components/RecurringMaintenancePanel'
import {
  useVendorBids, useVendorInvoices, useVendorPerformance, useWorkOrderReview,
  type VendorBid, type VendorInvoice
} from '@/hooks/useVendorUpgrade'

// TYPES
type WorkOrder = {
  id: string
  title: string
  description: string
  priority: string
  status: string
  created_at: string

  // Raw FK ids (selected alongside joined objects so the filter toolbar
  // can match without relying on the embedded join object structure).
  tenant_id: string | null
  unit_id: string | null
  vendor_id: string | null

  // Cost tracking
  cost: number
  hours_worked: number
  labor_cost: number
  invoice_amount: number | null
  materials_cost: number

  // AI triage
  category: string | null
  ai_priority: string | null
  ai_confidence: number | null
  ai_suggested_vendor_id: string | null

  // Scheduling
  scheduled_date: string | null
  due_date: string | null

  // Ledger commit tracking
  ledger_committed: boolean
  cost_pending_review: boolean
  bidding_open: boolean

  // 1. Linked Tenant (From Tenants Table)
  tenants?: {
    first_name: string
    last_name: string
  } | null

  // 2. Linked Location (Where)
  units?: {
    name: string
    properties?: {
      name: string
    } | null
  } | null

  // 3. Assigned Vendor
  vendors?: {
    id: string
    company_name: string | null
    contact_name: string | null
    hourly_rate: number | null
  } | null
}

type UpdateLog = {
  id: string
  note: string
  image_url: string | null
  created_at: string
  profiles: { full_name: string } 
}

export default function MaintenancePage() {
  const [tickets, setTickets] = useState<WorkOrder[]>([])
  const [selectedTicket, setSelectedTicket] = useState<WorkOrder | null>(null)
  const [logs, setLogs] = useState<UpdateLog[]>([])
  
  const [userId, setUserId] = useState<string>('')
  const [userRole, setUserRole] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [showAssignModal, setShowAssignModal] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'calendar' | 'recurring'>('list')
  const [triaging, setTriaging] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [upgradeEnabled, setUpgradeEnabled] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [invoiceNotes, setInvoiceNotes] = useState('')

  const isAdmin = userRole === 'Admin' || userRole === 'Property Manager'

  // ── FILTER TOOLBAR STATE ──
  // Pure client-side filtering — tickets are already fetched with all joins,
  // so we slice in-memory rather than re-querying. Keep this lightweight so
  // typing in the search box stays responsive.
  const [search, setSearch] = useState('')
  const [vendorFilter, setVendorFilter] = useState<string>('') // '' = any, '__unassigned__' = no vendor
  const [tenantFilter, setTenantFilter] = useState<string>('')
  const [propertyFilter, setPropertyFilter] = useState<string>('')
  const [unitFilter, setUnitFilter] = useState<string>('')

  // Dropdown data sources.
  const { vendors } = useVendors()
  const { properties } = useProperties()
  const [allTenants, setAllTenants] = useState<Array<{ id: string; first_name: string; last_name: string }>>([])
  const [allUnits, setAllUnits] = useState<Array<{ id: string; name: string; property_id: string }>>([])

  useEffect(() => {
    // Fetch once on mount — these dropdowns only need id+label, so pagination
    // isn't a concern even for large portfolios.
    supabase
      .from('tenants')
      .select('id, first_name, last_name')
      .order('first_name')
      .then(({ data }) => { if (data) setAllTenants(data) })
    supabase
      .from('units')
      .select('id, name, property_id')
      .order('name')
      .then(({ data }) => { if (data) setAllUnits(data) })
  }, [])

  // Clear unit selection when the property changes so we don't end up with
  // a unit that belongs to a different property than the filter says.
  useEffect(() => { setUnitFilter('') }, [propertyFilter])

  const unitsForFilter = propertyFilter
    ? allUnits.filter(u => u.property_id === propertyFilter)
    : allUnits

  const activeFilterCount =
    (search ? 1 : 0) +
    (vendorFilter ? 1 : 0) +
    (tenantFilter ? 1 : 0) +
    (propertyFilter ? 1 : 0) +
    (unitFilter ? 1 : 0)

  const clearFilters = () => {
    setSearch('')
    setVendorFilter('')
    setTenantFilter('')
    setPropertyFilter('')
    setUnitFilter('')
  }

  const filteredTickets = tickets.filter(t => {
    // Vendor — '__unassigned__' keeps only tickets with no vendor.
    if (vendorFilter === '__unassigned__') {
      if (t.vendor_id) return false
    } else if (vendorFilter && t.vendor_id !== vendorFilter) {
      return false
    }

    if (tenantFilter && t.tenant_id !== tenantFilter) return false

    // Unit filter is specific; property filter is broader. If a unit is
    // selected, match by unit only. If only a property is selected, match
    // any ticket whose unit belongs to that property.
    if (unitFilter) {
      if (t.unit_id !== unitFilter) return false
    } else if (propertyFilter) {
      const unitIdsInProperty = new Set(
        allUnits.filter(u => u.property_id === propertyFilter).map(u => u.id)
      )
      if (!t.unit_id || !unitIdsInProperty.has(t.unit_id)) return false
    }

    if (search) {
      const term = search.toLowerCase()
      const haystack = [t.title, t.description].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(term)) return false
    }

    return true
  })

  // Vendor upgrade hooks
  const { bids, acceptBid: handleAcceptBid, rejectBid: handleRejectBid, accepting, rejecting } = useVendorBids(upgradeEnabled ? selectedTicket?.id ?? null : null)
  const { invoices, reviewInvoice: handleReviewInvoice, reviewing } = useVendorInvoices(upgradeEnabled ? selectedTicket?.id ?? null : null)
  const vendorIdForPerf = upgradeEnabled ? selectedTicket?.vendors?.id ?? null : null
  const { performance: perfData } = useVendorPerformance(vendorIdForPerf)
  const vendorPerf = perfData.length > 0 ? perfData[0] : null
  const { review: existingReview } = useWorkOrderReview(upgradeEnabled ? selectedTicket?.id ?? null : null)

  // 1. FETCH DATA
  const fetchData = async () => {
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError) console.error('Auth Error:', authError.message)
    if (user) {
      setUserId(user.id)
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      setUserRole(profile?.role || 'Maintenance')
    }

    // Check vendor upgrade feature flag
    const flagRes = await supabase.from('feature_flags').select('value').eq('key', 'vendor_portal_upgrade').single()
    setUpgradeEnabled(flagRes.data?.value === true)

    // Fetch active (non-archived) work orders with joins
    const { data, error } = await supabase
      .from('work_orders')
      .select(`
        id, title, description, priority, status, created_at, scheduled_date, due_date,
        cost, hours_worked, labor_cost, invoice_amount, materials_cost,
        category, ai_priority, ai_confidence, ai_suggested_vendor_id, ledger_committed, cost_pending_review, bidding_open,
        tenant_id, unit_id, vendor_id, assigned_vendor, notes,
        tenants:tenant_id(first_name, last_name),
        units!work_orders_unit_id_fkey(
          name,
          properties ( name )
        ),
        vendors:vendor_id(id, company_name, contact_name, hourly_rate)
      `)
      .eq('archived', false)
      .order('created_at', { ascending: false })

    if (error) console.error('Fetch Error:', error.message, error.details, error.hint)
    if (data) {
      const fresh = data as unknown as WorkOrder[]
      setTickets(fresh)
      // Refresh selectedTicket with fresh data so the card updates immediately
      setSelectedTicket(prev => {
        if (!prev) return prev
        return fresh.find(t => t.id === prev.id) || null
      })
    }
    setLoading(false)
  }

  // 1B. Schedule date change handler
  const handleScheduleChange = async (field: 'scheduled_date' | 'due_date', value: string | null) => {
    if (!selectedTicket) return
    const { error } = await supabase
      .from('work_orders')
      .update({ [field]: value })
      .eq('id', selectedTicket.id)
    if (error) {
      toast.error('Failed to update: ' + error.message)
      return
    }
    toast.success(field === 'scheduled_date' ? 'Scheduled date updated' : 'Due date updated')
    setSelectedTicket(prev => prev ? { ...prev, [field]: value } : prev)
    await fetchData()
  }

  // 2. Fetch Logs
  const fetchLogs = async (ticketId: string) => {
    const { data } = await supabase
      .from('work_order_updates')
      .select('*, profiles(full_name)')
      .eq('work_order_id', ticketId)
      .order('created_at', { ascending: false })
    if (data) setLogs(data)
  }

  // AI Triage — calls Gemini-powered edge function with rule-based fallback
  const runTriage = async (ticketId: string) => {
    setTriaging(true)
    try {
      const { data, error } = await supabase.functions.invoke('triage-work-order', {
        body: { work_order_id: ticketId }
      })
      if (error) {
        // Extract real error from FunctionsHttpError context
        let errorMessage = error.message
        try {
          const ctx = (error as any)?.context
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json()
            errorMessage = body?.error || errorMessage
          }
        } catch { /* ignore parse failures */ }
        throw new Error(errorMessage)
      }
      if (data?.skipped) {
        toast.info(data.reason || 'Triage skipped (feature flag off)')
      } else {
        // Refresh to show updated AI fields
        await fetchData()
        if (selectedTicket?.id === ticketId) {
          setSelectedTicket((prev) => prev ? {
            ...prev,
            category: data.category,
            ai_priority: data.ai_priority,
            ai_confidence: data.ai_confidence,
            ai_suggested_vendor_id: data.suggested_vendor_id,
          } : prev)
        }
        toast.success(`Triaged as ${data.category} (${data.ai_confidence}% confidence)`)
      }
    } catch (err: any) {
      toast.error('Triage failed: ' + err.message)
    }
    setTriaging(false)
  }

  // Commit expense to ledger
  const commitToLedger = async (workOrderId: string) => {
    setCommitting(true)
    try {
      const { data, error } = await supabase.rpc('commit_work_order_expense', { p_work_order_id: workOrderId })
      if (error) throw error
      toast.success(`Expense of $${data.amount} committed to ledger`)
      await fetchData()
      // Update selected ticket state so button immediately shows "Committed"
      setSelectedTicket((prev) => prev?.id === workOrderId ? { ...prev, ledger_committed: true } : prev)
    } catch (err: any) {
      toast.error('Ledger commit failed: ' + err.message)
    }
    setCommitting(false)
  }

  useEffect(() => { fetchData() }, [])

  // 3. Handle Update
  const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!selectedTicket) return
    setUploading(true)

    const formData = new FormData(e.currentTarget)
    formData.append('workOrderId', selectedTicket.id)
    // Note: userId is no longer sent — the server action derives it from the auth session

    // Compress image on client side before sending to server action
    const imageFile = formData.get('image') as File | null
    if (imageFile && imageFile.size > 0) {
      try {
        const compressed = await compressImage(imageFile)
        formData.set('image', compressed)
      } catch (err) {
        console.warn('Compression failed, sending original:', err)
      }
    }

    await submitMaintenanceUpdate(formData)
    await Promise.all([fetchLogs(selectedTicket.id), fetchData()])
    setUploading(false)
    
    const form = e.target as HTMLFormElement
    const noteInput = form.elements.namedItem('note') as HTMLInputElement
    if(noteInput) noteInput.value = ''
    const fileInput = form.elements.namedItem('image') as HTMLInputElement
    if(fileInput) fileInput.value = ''
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 flex flex-col md:flex-row gap-4 md:gap-6 h-auto md:h-[calc(100vh-100px)] animate-in fade-in">

      {/* LIST / CALENDAR COLUMN */}
      <div className={`w-full ${viewMode === 'calendar' ? 'md:w-1/2 lg:w-3/5' : 'md:w-1/3'} flex flex-col gap-4 overflow-y-auto md:pr-2 pb-4 md:pb-20 max-h-[40vh] md:max-h-none`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-black italic uppercase text-slate-900">Work Orders</h2>
            {isAdmin && (
              <Link
                href="/admin/maintenance/turns"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-700 hover:bg-amber-100 transition border border-amber-200"
              >
                <RotateCcw size={12} /> Unit Turns
              </Link>
            )}
          </div>
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${
                viewMode === 'list' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <List size={12} /> List
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${
                viewMode === 'calendar' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <CalendarDays size={12} /> Calendar
            </button>
            <button
              onClick={() => setViewMode('recurring')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${
                viewMode === 'recurring' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <Clock size={12} /> Recurring
            </button>
          </div>
        </div>

        {viewMode === 'recurring' ? (
          <RecurringMaintenancePanel />
        ) : viewMode === 'calendar' ? (
          <MaintenanceCalendar
            onSelectWorkOrder={(id) => {
              const ticket = tickets.find(t => t.id === id)
              if (ticket) { setSelectedTicket(ticket); fetchLogs(ticket.id) }
            }}
          />
        ) : (
        <>
        {/* FILTER TOOLBAR */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or description..."
              className="w-full pl-9 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 truncate"
            >
              <option value="">All Vendors</option>
              <option value="__unassigned__">— Unassigned —</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.company_name || v.contact_name || 'Unnamed'}</option>
              ))}
            </select>
            <select
              value={tenantFilter}
              onChange={(e) => setTenantFilter(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 truncate"
            >
              <option value="">All Tenants</option>
              {allTenants.map(t => (
                <option key={t.id} value={t.id}>{t.first_name} {t.last_name}</option>
              ))}
            </select>
            <select
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 truncate"
            >
              <option value="">All Properties</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={unitFilter}
              onChange={(e) => setUnitFilter(e.target.value)}
              disabled={!propertyFilter && unitsForFilter.length > 100}
              title={!propertyFilter && unitsForFilter.length > 100 ? 'Pick a property first to narrow units' : ''}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 truncate disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">{propertyFilter ? 'All Units in Property' : 'All Units'}</option>
              {unitsForFilter.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Filter size={10} />
                {filteredTickets.length} of {tickets.length} shown
              </span>
              <button
                onClick={clearFilters}
                className="text-[10px] font-black uppercase tracking-wider text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors"
              >
                <X size={10} /> Clear filters
              </button>
            </div>
          )}
        </div>

        {loading && <Loader2 className="animate-spin text-slate-400" />}

        {!loading && filteredTickets.length === 0 && tickets.length > 0 && (
          <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase tracking-widest">
            No work orders match these filters
          </div>
        )}

        {filteredTickets.map(ticket => {
          const propertyName = ticket.units?.properties?.name || 'Unknown Property'
          const unitName = ticket.units?.name || 'No Unit'
          const locationString = `${propertyName} - Unit ${unitName}`
          // Use Tenant Name
          const tenantName = ticket.tenants ? `${ticket.tenants.first_name} ${ticket.tenants.last_name}`.trim() : 'Unassigned Tenant'

          return (
            <div 
              key={ticket.id}
              onClick={() => { setSelectedTicket(ticket); fetchLogs(ticket.id) }}
              className={`p-6 rounded-2xl border cursor-pointer transition-all group ${
                selectedTicket?.id === ticket.id 
                  ? 'bg-slate-900 text-white border-slate-900 shadow-xl' 
                  : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-500'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                 <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${
                   ticket.priority === 'Emergency' ? 'bg-red-500 text-white' : 
                   ticket.priority === 'High' ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-500'
                 }`}>
                   {ticket.priority}
                 </span>
                 <span className="text-[10px] font-bold uppercase opacity-60">
                   {new Date(ticket.created_at).toLocaleDateString()}
                 </span>
              </div>

              <h3 className="font-bold text-lg mb-1">{ticket.title}</h3>
              
              {/* TENANT NAME (From Tenants Table) */}
              <div className={`flex items-center gap-2 text-xs font-bold uppercase mb-1 ${
                 selectedTicket?.id === ticket.id ? 'text-slate-400' : 'text-slate-500'
              }`}>
                 <UserCircle size={14} /> 
                 {tenantName}
              </div>

              {/* LOCATION */}
              <div className={`text-xs font-black uppercase flex items-center gap-2 ${
                 selectedTicket?.id === ticket.id ? 'text-emerald-400' : 'text-emerald-600'
              }`}>
                 <MapPin size={14} />
                 {locationString}
              </div>

              {/* SCHEDULED DATE BADGE */}
              {ticket.scheduled_date && (
                <div className={`mt-2 flex items-center gap-1.5 text-[10px] font-black uppercase ${
                  selectedTicket?.id === ticket.id ? 'text-blue-300' : 'text-blue-600'
                }`}>
                  <CalendarDays size={12} />
                  Scheduled: {new Date(ticket.scheduled_date + 'T12:00:00').toLocaleDateString()}
                </div>
              )}

              {/* COST BADGE */}
              {(ticket as any).cost > 0 && (
                <div className={`mt-2 flex items-center gap-1.5 text-[10px] font-black uppercase ${
                  selectedTicket?.id === ticket.id ? 'text-emerald-400' : 'text-emerald-600'
                }`}>
                  <DollarSign size={12} />
                  ${(ticket as any).cost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              )}

              {/* AI CATEGORY BADGE */}
              {ticket.category && (
                <div className={`mt-2 flex items-center gap-1.5 text-[10px] font-black uppercase ${
                  selectedTicket?.id === ticket.id ? 'text-violet-300' : 'text-violet-500'
                }`}>
                  <Sparkles size={12} />
                  {ticket.category}
                  {ticket.ai_confidence && (
                    <span className="opacity-60 ml-1">{ticket.ai_confidence}%</span>
                  )}
                </div>
              )}
            </div>
          )
        })}
        </>
        )}
      </div>

      {/* DETAILS COLUMN */}
      <div className="flex-1 bg-white rounded-[2rem] md:rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col relative min-h-[50vh] md:min-h-0">
        {selectedTicket ? (
          <form key={selectedTicket.id} onSubmit={handleUpdate} className="flex flex-col h-full">

            {/* ACTION BAR — pinned at top so it's always reachable */}
            <div className="p-6 border-b border-slate-100 bg-white z-10 shadow-sm">
               <div className="flex gap-4 items-start">
                  <select name="status" defaultValue={selectedTicket.status} className="bg-slate-50 border border-slate-200 text-xs font-black uppercase rounded-xl px-4 py-3 cursor-pointer outline-none focus:ring-2 focus:ring-blue-500/20 h-[46px]">
                    <option value="Open">Status: Open</option>
                    <option value="Assigned">Assigned</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Completed">Completed</option>
                    <option value="On Hold">On Hold</option>
                  </select>

                  <div className="flex-1 flex gap-2">
                    <input name="note" placeholder="Add update note..." className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500/20 h-[46px]" />
                    <label className="flex items-center justify-center w-[46px] h-[46px] bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:bg-blue-50 hover:text-blue-600 transition-all text-slate-400">
                      <Camera size={20} />
                      <input type="file" name="image" accept="image/*" className="hidden" />
                    </label>
                    <button type="submit" disabled={uploading} className="bg-slate-900 text-white rounded-xl px-6 h-[46px] font-black text-xs uppercase tracking-widest hover:bg-emerald-500 transition-colors flex items-center gap-2">
                      {uploading ? <Loader2 className="animate-spin" size={16}/> : <Send size={16} />}
                      {uploading ? 'Saving...' : 'Update'}
                    </button>
                  </div>
               </div>
            </div>

            {/* SCROLLABLE CONTENT: details + logs together */}
            <div className="flex-1 overflow-y-auto">

            <div className="p-8 border-b border-slate-100 bg-slate-50 space-y-4">
               {/* Title & Requestor */}
               <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <input 
                      name="title"
                      defaultValue={selectedTicket.title}
                      disabled={!isAdmin}
                      className="w-full bg-transparent text-2xl font-black text-slate-900 placeholder-slate-300 outline-none border-b border-transparent focus:border-blue-500 transition-colors disabled:cursor-text"
                    />
                    <div className="flex items-center gap-2 mt-1 text-xs font-bold text-slate-400 uppercase tracking-wide">
                       <User size={12} /> Tenant: <span className="text-slate-900">{selectedTicket.tenants ? `${selectedTicket.tenants.first_name} ${selectedTicket.tenants.last_name}`.trim() : 'Unassigned'}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs font-bold text-slate-400 uppercase tracking-wide">
                       <Wrench size={12} /> Vendor: <span className="text-slate-900">{selectedTicket.vendors?.company_name || selectedTicket.vendors?.contact_name || 'Unassigned'}</span>
                       {isAdmin && (
                         <>
                           <button
                             type="button"
                             onClick={() => setShowAssignModal(true)}
                             className="ml-2 px-2 py-0.5 bg-indigo-600 text-white rounded text-[9px] font-black uppercase hover:bg-indigo-500 transition-colors flex items-center gap-1"
                           >
                             <UserPlus size={10} /> {selectedTicket.vendors ? 'Reassign' : 'Assign'}
                           </button>
                           {/* Show Triage when AI hasn't run yet (ai_confidence null).
                               A ticket with a manually-set category still deserves an
                               AI vendor suggestion, so we gate on AI data, not category. */}
                           {!selectedTicket.ai_confidence && (
                             <button
                               type="button"
                               onClick={() => runTriage(selectedTicket.id)}
                               disabled={triaging}
                               className="ml-1 px-2 py-0.5 bg-violet-600 text-white rounded text-[9px] font-black uppercase hover:bg-violet-500 transition-colors flex items-center gap-1 disabled:opacity-50"
                             >
                               {triaging ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />} Triage
                             </button>
                           )}
                         </>
                       )}
                    </div>
                    {selectedTicket.ai_suggested_vendor_id && !selectedTicket.vendors && (
                      <div className="flex items-center gap-2 mt-1 text-xs font-bold text-violet-500 uppercase tracking-wide">
                        <Sparkles size={12} /> AI Suggested Vendor Available
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => setShowAssignModal(true)}
                            className="ml-1 px-2 py-0.5 bg-violet-600 text-white rounded text-[9px] font-black uppercase hover:bg-violet-500 transition-colors"
                          >
                            Review
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Priority */}
                  <select 
                    name="priority"
                    defaultValue={selectedTicket.priority}
                    disabled={!isAdmin}
                    className="bg-white px-3 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 outline-none disabled:bg-slate-100 disabled:text-slate-500 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Emergency">Emergency</option>
                  </select>
               </div>

               {/* LOCATION DISPLAY */}
               <div className="flex items-center gap-2 px-4 py-3 rounded-xl border bg-white border-slate-200">
                 <MapPin size={18} className="text-emerald-600" />
                 <span className="text-sm font-black text-slate-900 uppercase">
                    {selectedTicket.units?.properties?.name || 'Unknown'} 
                    <span className="text-slate-400 mx-2">|</span> 
                    Unit {selectedTicket.units?.name || 'N/A'}
                 </span>
               </div>

               {/* SCHEDULING (Admin Only) */}
               {isAdmin && (
                 <div className="grid grid-cols-2 gap-4">
                   <ScheduleDatePicker
                     label="Scheduled Date"
                     value={selectedTicket.scheduled_date}
                     onChange={(date) => handleScheduleChange('scheduled_date', date)}
                     vendorId={selectedTicket.vendors?.id}
                   />
                   <ScheduleDatePicker
                     label="Due Date"
                     value={selectedTicket.due_date}
                     onChange={(date) => handleScheduleChange('due_date', date)}
                     vendorId={selectedTicket.vendors?.id}
                     minDate={selectedTicket.scheduled_date}
                   />
                 </div>
               )}

               {/* AI TRIAGE INFO */}
               {selectedTicket.category && (
                 <div className="flex items-center gap-4 px-4 py-3 rounded-xl bg-violet-50 border border-violet-100">
                   <Sparkles size={18} className="text-violet-500 shrink-0" />
                   <div className="flex-1 flex items-center gap-4 text-xs">
                     <div>
                       <span className="font-black text-violet-400 uppercase text-[9px] tracking-widest">Category</span>
                       <p className="font-black text-violet-700">{selectedTicket.category}</p>
                     </div>
                     {selectedTicket.ai_priority && (
                       <div>
                         <span className="font-black text-violet-400 uppercase text-[9px] tracking-widest">AI Priority</span>
                         <p className={`font-black ${
                           selectedTicket.ai_priority === 'Emergency' ? 'text-red-600' :
                           selectedTicket.ai_priority === 'High' ? 'text-orange-600' : 'text-violet-700'
                         }`}>{selectedTicket.ai_priority}</p>
                       </div>
                     )}
                     {selectedTicket.ai_confidence && (
                       <div>
                         <span className="font-black text-violet-400 uppercase text-[9px] tracking-widest">Confidence</span>
                         <p className="font-black text-violet-700">{selectedTicket.ai_confidence}%</p>
                       </div>
                     )}
                   </div>
                 </div>
               )}

               {/* Description */}
               <textarea
                 name="description"
                 defaultValue={selectedTicket.description}
                 disabled={!isAdmin}
                 className="w-full bg-white p-4 rounded-xl border border-slate-200 text-sm text-slate-600 leading-relaxed outline-none focus:border-blue-500 transition-colors disabled:bg-slate-100/50 disabled:text-slate-600 resize-none h-20"
                 placeholder="Description..."
               />

               {/* COST BREAKDOWN (Admin Only) */}
               {isAdmin && (
                 <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                   <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                     <DollarSign size={12} /> Cost Breakdown
                   </h4>

                   <div className="grid grid-cols-2 gap-4">
                     {/* Hours Worked */}
                     <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hours Worked</label>
                       <input
                         name="hours_worked"
                         type="number"
                         step="0.5"
                         min="0"
                         defaultValue={selectedTicket.hours_worked || ''}
                         placeholder="0.0"
                         className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                       />
                     </div>

                     {/* Vendor Rate (read-only) */}
                     <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Vendor Rate</label>
                       <div className="px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-500">
                         {selectedTicket.vendors?.hourly_rate
                           ? `$${selectedTicket.vendors.hourly_rate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr`
                           : 'No rate set'}
                       </div>
                     </div>
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                     {/* Calculated Labor (read-only) */}
                     <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Calculated Labor</label>
                       <div className="px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm font-bold text-emerald-700">
                         ${selectedTicket.labor_cost?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                       </div>
                     </div>

                     {/* Invoice Override */}
                     <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Invoice Amount (Override)</label>
                       <input
                         name="invoice_amount"
                         type="number"
                         step="0.01"
                         min="0"
                         defaultValue={selectedTicket.invoice_amount ?? ''}
                         placeholder="Leave blank to use calculated"
                         className="w-full px-4 py-3 bg-slate-50 border border-orange-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-orange-500"
                       />
                     </div>
                   </div>

                   <div className="grid grid-cols-2 gap-4">
                     {/* Materials Cost */}
                     <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Materials Cost</label>
                       <input
                         name="materials_cost"
                         type="number"
                         step="0.01"
                         min="0"
                         defaultValue={selectedTicket.materials_cost || ''}
                         placeholder="0.00"
                         className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-blue-500"
                       />
                     </div>

                     {/* Total Cost (read-only computed) */}
                     <div className="space-y-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Cost</label>
                       <div className="px-4 py-3 bg-slate-900 rounded-xl text-sm font-black text-white flex items-center gap-2">
                         ${selectedTicket.cost?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                         {selectedTicket.cost_pending_review && (
                           <span className="text-[9px] font-bold bg-amber-500 text-black px-2 py-0.5 rounded-full">PENDING REVIEW</span>
                         )}
                       </div>
                     </div>
                   </div>

                   {/* COMMIT TO LEDGER */}
                   {selectedTicket.cost > 0 && (
                     <div className="pt-2 border-t border-slate-100">
                       {(selectedTicket as any).ledger_committed ? (
                         <div className="flex items-center gap-2 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                           <CheckCircle2 size={16} className="text-emerald-600" />
                           <span className="text-xs font-black text-emerald-700 uppercase tracking-widest">Committed to Ledger</span>
                         </div>
                       ) : ['Completed', 'Closed', 'Done'].includes(selectedTicket.status) ? (
                         <button
                           type="button"
                           onClick={() => commitToLedger(selectedTicket.id)}
                           disabled={committing}
                           className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-500 transition-all shadow-lg disabled:opacity-50"
                         >
                           {committing ? <Loader2 size={16} className="animate-spin" /> : <BookOpen size={16} />}
                           {committing ? 'Committing...' : 'Commit Expense to Ledger'}
                         </button>
                       ) : (
                         <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl">
                           <BookOpen size={16} className="text-amber-500" />
                           <span className="text-xs font-bold text-amber-700">Complete this work order to commit expense to ledger</span>
                         </div>
                       )}
                     </div>
                   )}
                 </div>
               )}
            </div>

            {/* VENDOR UPGRADE SECTIONS */}
            {upgradeEnabled && isAdmin && selectedTicket && (
              <div className="px-8 pt-6 pb-2 space-y-4">

                {/* BIDDING TOGGLE + BID REVIEW (Open work orders) */}
                {selectedTicket.status === 'Open' && (
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Gavel size={12} /> Bidding
                      </h4>
                      <button
                        type="button"
                        onClick={async () => {
                          const newVal = !selectedTicket.bidding_open
                          await supabase.from('work_orders').update({ bidding_open: newVal }).eq('id', selectedTicket.id)
                          setSelectedTicket(prev => prev ? { ...prev, bidding_open: newVal } : prev)
                          toast.success(newVal ? 'Bidding opened' : 'Bidding closed')
                        }}
                        className="flex items-center gap-2 text-xs font-bold"
                      >
                        {selectedTicket.bidding_open ? (
                          <><ToggleRight size={20} className="text-emerald-500" /> <span className="text-emerald-600">Open</span></>
                        ) : (
                          <><ToggleLeft size={20} className="text-slate-400" /> <span className="text-slate-500">Closed</span></>
                        )}
                      </button>
                    </div>

                    {bids.length > 0 ? (
                      <div className="space-y-2">
                        {bids.map((bid: VendorBid) => (
                          <div key={bid.id} className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                            <div className="flex-1">
                              <p className="text-sm font-bold text-slate-900">{bid.vendor_name}</p>
                              <div className="flex items-center gap-3 text-xs text-slate-500">
                                <span className="font-black text-emerald-600">${bid.bid_amount}</span>
                                {bid.estimated_hours && <span>{bid.estimated_hours} hrs</span>}
                                {bid.proposed_start && <span>Start: {new Date(bid.proposed_start).toLocaleDateString()}</span>}
                              </div>
                              {bid.notes && <p className="text-xs text-slate-400 mt-1 line-clamp-1">{bid.notes}</p>}
                            </div>
                            <div className="flex items-center gap-2 ml-4">
                              {bid.status === 'Pending' ? (
                                <>
                                  <button type="button" onClick={() => handleAcceptBid(bid.id)} disabled={accepting}
                                    className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase hover:bg-emerald-500 transition-colors disabled:opacity-50">
                                    Accept
                                  </button>
                                  <button type="button" onClick={() => handleRejectBid(bid.id)} disabled={rejecting}
                                    className="px-3 py-1.5 bg-red-100 text-red-600 rounded-lg text-[10px] font-black uppercase hover:bg-red-200 transition-colors disabled:opacity-50">
                                    Reject
                                  </button>
                                </>
                              ) : (
                                <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${
                                  bid.status === 'Accepted' ? 'bg-emerald-100 text-emerald-600' :
                                  bid.status === 'Rejected' ? 'bg-red-100 text-red-600' :
                                  'bg-slate-100 text-slate-500'
                                }`}>{bid.status}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : selectedTicket.bidding_open ? (
                      <p className="text-xs text-slate-400 text-center py-2">No bids yet — vendors can now see this work order</p>
                    ) : (
                      <p className="text-xs text-slate-400 text-center py-2">Toggle bidding to allow vendors to submit bids</p>
                    )}
                  </div>
                )}

                {/* INVOICE REVIEW (for work orders with invoices) */}
                {invoices.length > 0 && (
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <FileText size={12} /> Invoices
                    </h4>
                    {invoices.map((inv: VendorInvoice) => (
                      <div key={inv.id} className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-slate-900">{inv.vendor_name}</p>
                            <p className="text-lg font-black text-emerald-600">${inv.amount}</p>
                            {inv.description && <p className="text-xs text-slate-500">{inv.description}</p>}
                          </div>
                          <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${
                            inv.status === 'Submitted' ? 'bg-blue-100 text-blue-600' :
                            inv.status === 'Approved' ? 'bg-emerald-100 text-emerald-600' :
                            inv.status === 'Rejected' ? 'bg-red-100 text-red-600' :
                            'bg-yellow-100 text-yellow-600'
                          }`}>{inv.status}</span>
                        </div>
                        {inv.file_url && (
                          <a href={inv.file_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 hover:underline">
                            <ExternalLink size={12} /> {inv.file_name || 'View Invoice File'}
                          </a>
                        )}
                        {['Submitted', 'Under Review'].includes(inv.status) && (
                          <div className="space-y-2">
                            <input
                              type="text" placeholder="Admin notes (optional)..."
                              value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm outline-none focus:border-blue-500"
                            />
                            <div className="flex gap-2">
                              <button type="button" disabled={reviewing}
                                onClick={async () => { await handleReviewInvoice(inv.id, 'approve', invoiceNotes); setInvoiceNotes(''); await fetchData() }}
                                className="flex-1 py-2 bg-emerald-600 text-white rounded-lg text-xs font-black uppercase hover:bg-emerald-500 transition-colors disabled:opacity-50">
                                Approve
                              </button>
                              <button type="button" disabled={reviewing}
                                onClick={async () => { await handleReviewInvoice(inv.id, 'reject', invoiceNotes); setInvoiceNotes('') }}
                                className="flex-1 py-2 bg-red-100 text-red-600 rounded-lg text-xs font-black uppercase hover:bg-red-200 transition-colors disabled:opacity-50">
                                Reject
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* VENDOR PERFORMANCE + RATING */}
                {selectedTicket.vendors && (
                  <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Star size={12} /> Vendor Performance
                    </h4>
                    {vendorPerf ? (
                      <VendorPerformanceBadge
                        avgRating={vendorPerf.avg_rating}
                        completedJobs={vendorPerf.total_completed_jobs}
                        reviewCount={vendorPerf.review_count}
                      />
                    ) : (
                      <p className="text-xs text-slate-400">No performance data yet</p>
                    )}

                    {/* Rate button (only for completed, no existing review) */}
                    {['Completed', 'Closed', 'Done'].includes(selectedTicket.status) && (
                      existingReview ? (
                        <div className="flex items-center gap-2 bg-emerald-50 rounded-xl px-4 py-3 border border-emerald-100">
                          <div className="flex items-center gap-0.5">
                            {[1,2,3,4,5].map(i => (
                              <Star key={i} size={14} className={i <= existingReview.rating ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'} />
                            ))}
                          </div>
                          <span className="text-xs font-bold text-emerald-700">Rated</span>
                          {existingReview.comment && <span className="text-xs text-slate-500 truncate ml-1">— {existingReview.comment}</span>}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowReviewModal(true)}
                          className="w-full py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-500 transition-colors flex items-center justify-center gap-2"
                        >
                          <Star size={14} /> Rate Vendor
                        </button>
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {/* UPDATES LOG */}
            <div className="p-8 space-y-6 bg-slate-50/50">
              {logs.length > 0 && (
                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                  <Clock size={12} /> Updates ({logs.length})
                </h4>
              )}
              {logs.map(log => (
                <div key={log.id} className="flex gap-4 animate-in slide-in-from-top-2 duration-300">
                   <div className="w-10 h-10 rounded-xl bg-white border border-slate-100 flex items-center justify-center text-slate-700 font-black text-xs shadow-sm">
                     {log.profiles?.full_name?.charAt(0) || <User size={16}/>}
                   </div>
                   <div className="flex-1 space-y-2 max-w-2xl">
                      <div className="flex items-baseline gap-2">
                         <span className="text-xs font-black text-slate-900">{log.profiles?.full_name || 'Staff Member'}</span>
                         <span className="text-[9px] font-bold text-slate-400 uppercase">{new Date(log.created_at).toLocaleString()}</span>
                      </div>
                      <div className="bg-white p-4 rounded-2xl rounded-tl-none border border-slate-200 shadow-sm text-sm font-medium text-slate-700 leading-relaxed">
                        {log.note}
                      </div>
                      {log.image_url && (
                        <div className="relative h-48 w-full mt-2">
                          <Image src={log.image_url} alt="Proof" fill className="rounded-2xl border border-slate-200 object-cover shadow-sm" sizes="400px" />
                        </div>
                      )}
                   </div>
                </div>
              ))}
            </div>

            </div>{/* end scrollable content wrapper */}
          </form>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 bg-slate-50/30">
             <Wrench size={64} className="mb-6 opacity-10" />
             <p className="text-sm font-black uppercase tracking-widest opacity-50">Select a Work Order</p>
          </div>
        )}
      </div>

      {/* ASSIGN VENDOR MODAL */}
      <AssignVendorModal
        isOpen={showAssignModal}
        onClose={() => setShowAssignModal(false)}
        onSuccess={() => {
          setShowAssignModal(false)
          fetchData()
        }}
        ticketId={selectedTicket?.id || ''}
        ticketTitle={selectedTicket?.title || ''}
        suggestedVendorId={selectedTicket?.ai_suggested_vendor_id ?? null}
      />

      {/* VENDOR REVIEW MODAL */}
      {upgradeEnabled && selectedTicket?.vendors && (
        <VendorReviewModal
          isOpen={showReviewModal}
          onClose={() => setShowReviewModal(false)}
          vendorName={selectedTicket.vendors.company_name || selectedTicket.vendors.contact_name || 'Vendor'}
          workOrderTitle={selectedTicket.title}
          onSubmit={async (rating, comment) => {
            const { error } = await supabase.from('vendor_reviews').insert({
              work_order_id: selectedTicket.id,
              vendor_id: selectedTicket.vendors!.id,
              rating,
              comment: comment || null,
              reviewed_by: userId,
            })
            if (error) throw error
            toast.success('Vendor review submitted')
          }}
        />
      )}
    </div>
  )
}