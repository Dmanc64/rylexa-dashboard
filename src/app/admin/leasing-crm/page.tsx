'use client'

import { useState, useEffect } from 'react'
import {
  Users, Plus, Search, Filter, Loader2,
  Mail, Phone, Calendar, DollarSign,
  ChevronRight, ChevronLeft, MapPin,
  Clock, MessageSquare, Eye, XCircle,
  ArrowRight, Bed, Building2, Home,
  UserPlus, CalendarPlus, StickyNote,
  Send, FileText, ExternalLink, Sparkles
} from 'lucide-react'
import { toast } from 'sonner'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useLeads, useLeadPipeline, useLeadActivities, useTours,
  LEAD_STAGES, LEAD_SOURCE_OPTIONS, STAGE_COLORS,
  type Lead, type LeadFilters,
} from '@/hooks/useLeadsCRM'
import { useProperties } from '@/hooks/useProperties'
import NewLeadModal from '@/components/NewLeadModal'
import ScheduleTourModal from '@/components/ScheduleTourModal'
import LeasingAiDraftModal from '@/components/LeasingAiDraftModal'

// ── Activity type icons ──
const ACTIVITY_ICONS: Record<string, typeof MessageSquare> = {
  note: StickyNote,
  email: Mail,
  call: Phone,
  tour_scheduled: CalendarPlus,
  tour_completed: Eye,
  stage_change: ArrowRight,
  application: FileText,
  default: MessageSquare,
}

export default function LeasingCRMPage() {
  const { isEnabled } = useFeatureFlags()
  const crmEnabled = isEnabled('leasing_crm')

  // ── Filters ──
  const [stageFilter, setStageFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [propertyFilter, setPropertyFilter] = useState('')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

  const filters: LeadFilters = {
    stage: stageFilter || undefined,
    source: sourceFilter || undefined,
    property_id: propertyFilter || undefined,
    search: searchDebounced || undefined,
  }

  const {
    leads, loading,
    createLead, creating,
    updateLead, updating,
    markLeadLost, markingLost,
    advanceStage, advancingStage,
  } = useLeads(filters)

  const { pipeline, loading: pipelineLoading } = useLeadPipeline()
  const { properties } = useProperties()

  // ── Selected lead ──
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = leads.find(l => l.id === selectedId) || null

  // ── Activities for selected lead ──
  const { activities, loading: activitiesLoading, addActivity, addingActivity } = useLeadActivities(selectedId)

  // ── Tours for selected lead ──
  const { tours, loading: toursLoading } = useTours({})
  const selectedTours = selected
    ? tours.filter(t => t.lead_id === selected.id && t.status === 'Scheduled')
    : []

  // ── Modals ──
  const [isNewLeadOpen, setIsNewLeadOpen] = useState(false)
  const [isScheduleTourOpen, setIsScheduleTourOpen] = useState(false)
  const [isAiDraftOpen, setIsAiDraftOpen] = useState(false)

  // ── Inline note ──
  const [noteText, setNoteText] = useState('')

  // ── Mark lost ──
  const [showLostInput, setShowLostInput] = useState(false)
  const [lostReason, setLostReason] = useState('')

  // ── Search debounce ──
  const handleSearch = (value: string) => {
    setSearch(value)
    clearTimeout((window as any).__crmSearchTimer)
    ;(window as any).__crmSearchTimer = setTimeout(() => {
      setSearchDebounced(value)
    }, 400)
  }

  // Reset selected when filters change
  useEffect(() => {
    setSelectedId(null)
    setShowLostInput(false)
    setLostReason('')
  }, [stageFilter, sourceFilter, propertyFilter, searchDebounced])

  // ── Stage navigation ──
  const activeStages = LEAD_STAGES.filter(s => s !== 'Lost')
  const currentStageIndex = selected ? activeStages.indexOf(selected.stage) : -1

  const handleRegressStage = async () => {
    if (!selected || currentStageIndex <= 0) return
    const prevStage = activeStages[currentStageIndex - 1]
    try {
      await updateLead({ id: selected.id, stage: prevStage } as any)
    } catch {
      // Error handled by hook
    }
  }

  const handleAdvanceStage = async () => {
    if (!selected) return
    try {
      await advanceStage(selected.id)
    } catch {
      // Error handled by hook
    }
  }

  const handleAddNote = async () => {
    if (!selected || !noteText.trim()) return
    try {
      await addActivity({ leadId: selected.id, type: 'note', description: noteText.trim() })
      setNoteText('')
    } catch {
      // Error handled by hook
    }
  }

  const handleMarkLost = async () => {
    if (!selected || !lostReason.trim()) {
      toast.error('Please provide a reason')
      return
    }
    try {
      await markLeadLost({ id: selected.id, reason: lostReason.trim() })
      setShowLostInput(false)
      setLostReason('')
      setSelectedId(null)
    } catch {
      // Error handled by hook
    }
  }

  // ── Pipeline stage display (exclude Lost for pipeline cards) ──
  const displayStages = LEAD_STAGES.filter(s => s !== 'Lost')

  const getPipelineData = (stage: string) => {
    const match = pipeline.find(p => p.stage === stage)
    return { count: match?.count ?? 0, this_month: match?.this_month ?? 0 }
  }

  // ── Feature flag gate ──
  if (!crmEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <Users size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-black text-slate-900 italic">Leasing CRM</h2>
          <p className="text-slate-500 text-sm mt-2">
            This feature is not enabled. Enable the <strong>leasing_crm</strong> flag in Settings to activate.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 animate-in fade-in">

      {/* HEADER */}
      <div className="bg-white border-b border-slate-200 px-6 md:px-10 py-6">
        <div className="max-w-[1600px] mx-auto flex flex-col md:flex-row justify-between items-end gap-4">
          <div>
            <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
              Leasing <span className="text-emerald-600">CRM</span>
            </h1>
            <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
              {leads.length} Lead{leads.length !== 1 ? 's' : ''} &bull; Pipeline Management
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsScheduleTourOpen(true)}
              className="px-5 py-3 bg-white border-2 border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:border-emerald-500 hover:text-emerald-600 transition-all flex items-center gap-2"
            >
              <CalendarPlus size={16} /> Schedule Tour
            </button>
            <button
              onClick={() => setIsNewLeadOpen(true)}
              className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg hover:-translate-y-0.5"
            >
              <UserPlus size={16} /> New Lead
            </button>
          </div>
        </div>
      </div>

      {/* PIPELINE CARDS */}
      <div className="px-6 md:px-10 pt-6">
        <div className="max-w-[1600px] mx-auto">
          <div className="flex gap-3 overflow-x-auto pb-2">
            {displayStages.map(stage => {
              const { count, this_month } = getPipelineData(stage)
              const isActive = stageFilter === stage
              const colorClasses = STAGE_COLORS[stage] || 'bg-slate-100 text-slate-600'

              return (
                <button
                  key={stage}
                  onClick={() => setStageFilter(isActive ? '' : stage)}
                  className={`
                    flex-shrink-0 p-4 rounded-2xl border transition-all min-w-[160px]
                    ${isActive
                      ? 'bg-slate-900 border-slate-900 shadow-lg scale-[1.02]'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                    }
                  `}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                      isActive ? 'bg-white/20 text-white' : colorClasses
                    }`}>
                      {stage}
                    </span>
                  </div>
                  <p className={`text-2xl font-black italic ${isActive ? 'text-white' : 'text-slate-900'}`}>
                    {pipelineLoading ? '-' : count}
                  </p>
                  <p className={`text-[10px] font-bold ${isActive ? 'text-slate-400' : 'text-slate-400'}`}>
                    {pipelineLoading ? '...' : `${this_month} this month`}
                  </p>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* CONTROLS BAR */}
      <div className="px-6 md:px-10 pt-4">
        <div className="max-w-[1600px] mx-auto bg-white p-2 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row gap-2">
          <div className="relative min-w-[160px]">
            <Filter className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="w-full pl-10 pr-8 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs uppercase tracking-wider text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer appearance-none"
            >
              <option value="">All Sources</option>
              {LEAD_SOURCE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="relative min-w-[180px]">
            <Building2 className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <select
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              className="w-full pl-10 pr-8 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs uppercase tracking-wider text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer appearance-none"
            >
              <option value="">All Properties</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by name or email..."
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {/* TWO-COLUMN LAYOUT */}
      <div className="px-6 md:px-10 py-6">
        <div className="max-w-[1600px] mx-auto flex gap-6" style={{ minHeight: 'calc(100vh - 380px)' }}>

          {/* LEFT: LEAD LIST */}
          <div className="w-full md:w-[400px] shrink-0 space-y-3 overflow-y-auto max-h-[calc(100vh-380px)] pr-2">
            {loading ? (
              <div className="py-20 text-center">
                <Loader2 className="animate-spin mx-auto text-emerald-600 mb-4" size={32} />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading Leads...</p>
              </div>
            ) : leads.length === 0 ? (
              <div className="py-20 text-center">
                <Users size={48} className="text-slate-300 mx-auto mb-4" />
                <p className="text-slate-400 font-bold text-sm">
                  {search || stageFilter || sourceFilter || propertyFilter ? 'No leads match your filters' : 'No leads yet'}
                </p>
                {!search && !stageFilter && !sourceFilter && !propertyFilter && (
                  <p className="text-slate-400 text-xs mt-1">Create your first lead to get started.</p>
                )}
              </div>
            ) : (
              leads.map(lead => {
                const isActive = selectedId === lead.id
                const stageBadge = STAGE_COLORS[lead.stage] || 'bg-slate-100 text-slate-600'
                const sourceLabel = LEAD_SOURCE_OPTIONS.find(s => s.value === lead.source)?.label || lead.source

                return (
                  <button
                    key={lead.id}
                    onClick={() => {
                      setSelectedId(lead.id)
                      setShowLostInput(false)
                      setLostReason('')
                      setNoteText('')
                    }}
                    className={`
                      w-full text-left p-4 rounded-2xl border transition-all
                      ${isActive
                        ? 'bg-slate-900 border-slate-900 shadow-lg scale-[1.02]'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }
                    `}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 className={`font-black italic text-base truncate ${isActive ? 'text-white' : 'text-slate-900'}`}>
                        {lead.first_name} {lead.last_name}
                      </h3>
                      <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider shrink-0 ${
                        isActive ? 'bg-white/20 text-white' : stageBadge
                      }`}>
                        {lead.stage}
                      </span>
                    </div>
                    <p className={`text-xs font-bold truncate ${isActive ? 'text-slate-400' : 'text-slate-500'}`}>
                      {lead.email}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-bold ${
                        isActive ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {sourceLabel}
                      </span>
                      <span className={`text-[10px] font-bold ${isActive ? 'text-slate-500' : 'text-slate-400'}`}>
                        {new Date(lead.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {/* RIGHT: DETAIL PANEL */}
          <div className="flex-1 min-w-0 hidden md:block">
            {!selected ? (
              <div className="h-full flex items-center justify-center">
                <div className="text-center">
                  <Users size={64} className="text-slate-200 mx-auto mb-4" />
                  <p className="text-slate-400 font-bold text-sm italic">Select a lead to view details</p>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm max-h-[calc(100vh-380px)] overflow-y-auto animate-in fade-in slide-in-from-right-4">

                {/* Detail Header */}
                <div className="bg-slate-50 border-b border-slate-200 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-black text-slate-900 italic uppercase">
                        {selected.first_name} {selected.last_name}
                      </h2>
                      <div className="flex items-center gap-4 mt-2 flex-wrap">
                        {selected.email && (
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                            <Mail size={14} /> {selected.email}
                          </div>
                        )}
                        {selected.phone && (
                          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                            <Phone size={14} /> {selected.phone}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stage Badge */}
                    <span className={`inline-flex px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider ${STAGE_COLORS[selected.stage] || 'bg-slate-100 text-slate-600'}`}>
                      {selected.stage}
                    </span>
                  </div>

                  {/* Stage Navigation */}
                  {selected.stage !== 'Lost' && (
                    <div className="flex items-center gap-2 mt-4">
                      <button
                        onClick={handleRegressStage}
                        disabled={currentStageIndex <= 0 || advancingStage || updating}
                        className="p-2 bg-white border border-slate-200 rounded-xl text-slate-400 hover:text-slate-700 hover:border-slate-300 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Previous stage"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <div className="flex-1 flex gap-1">
                        {activeStages.map((stage, i) => (
                          <div
                            key={stage}
                            className={`h-2 flex-1 rounded-full transition-all ${
                              i <= currentStageIndex ? 'bg-emerald-500' : 'bg-slate-200'
                            }`}
                            title={stage}
                          />
                        ))}
                      </div>
                      <button
                        onClick={handleAdvanceStage}
                        disabled={currentStageIndex >= activeStages.length - 1 || advancingStage || updating}
                        className="p-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                        title="Advance stage"
                      >
                        {advancingStage ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                      </button>
                    </div>
                  )}
                </div>

                {/* Detail Body */}
                <div className="p-6 space-y-6">

                  {/* Key Info Grid */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Property</p>
                      <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <Building2 size={14} className="text-emerald-500" />
                        {selected.property_name || 'Not specified'}
                      </p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Unit</p>
                      <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <Home size={14} className="text-emerald-500" />
                        {selected.unit_name || 'Not specified'}
                      </p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Budget Max</p>
                      <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <DollarSign size={14} className="text-emerald-500" />
                        {selected.budget_max ? `$${selected.budget_max.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo` : 'Not specified'}
                      </p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Desired Move-In</p>
                      <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <Calendar size={14} className="text-emerald-500" />
                        {selected.desired_move_in ? new Date(selected.desired_move_in + 'T00:00:00').toLocaleDateString() : 'Not specified'}
                      </p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Bedrooms</p>
                      <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                        <Bed size={14} className="text-emerald-500" />
                        {selected.desired_bedrooms != null ? `${selected.desired_bedrooms} BR` : 'Not specified'}
                      </p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Source</p>
                      <p className="text-sm font-bold text-slate-900">
                        {LEAD_SOURCE_OPTIONS.find(s => s.value === selected.source)?.label || selected.source}
                      </p>
                    </div>
                  </div>

                  {/* Application Link */}
                  {selected.application_id && (
                    <a
                      href={`/admin/applications?id=${selected.application_id}`}
                      className="flex items-center gap-2 p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-sm font-bold text-emerald-700 hover:bg-emerald-100 transition-colors"
                    >
                      <FileText size={16} />
                      View Application
                      <ExternalLink size={14} className="ml-auto" />
                    </a>
                  )}

                  {/* Upcoming Tours */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <CalendarPlus size={12} /> Upcoming Tours
                      </h3>
                      <button
                        onClick={() => setIsScheduleTourOpen(true)}
                        className="text-[10px] font-bold text-emerald-600 hover:underline flex items-center gap-1"
                      >
                        <Plus size={12} /> Schedule
                      </button>
                    </div>
                    {toursLoading ? (
                      <div className="py-4 text-center">
                        <Loader2 size={16} className="animate-spin mx-auto text-emerald-500" />
                      </div>
                    ) : selectedTours.length === 0 ? (
                      <p className="text-xs text-slate-400 italic py-2">No upcoming tours scheduled</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedTours.map(tour => (
                          <div key={tour.id} className="p-3 bg-violet-50 border border-violet-200 rounded-xl flex items-center gap-3">
                            <CalendarPlus size={16} className="text-violet-600 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-violet-900 truncate">
                                {tour.property_name}{tour.unit_name ? ` - ${tour.unit_name}` : ''}
                              </p>
                              <p className="text-[10px] text-violet-500 font-bold">
                                {new Date(tour.scheduled_at).toLocaleString()} &bull; {tour.duration_minutes} min
                              </p>
                            </div>
                            {tour.conductor_name && (
                              <span className="text-[9px] font-bold text-violet-400 bg-violet-100 px-2 py-0.5 rounded-full shrink-0">
                                {tour.conductor_name}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Activity Timeline */}
                  <div>
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-3">
                      <Clock size={12} /> Activity Timeline
                    </h3>

                    {/* Add Note Form */}
                    <div className="flex gap-2 mb-4">
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNote() } }}
                        placeholder="Add a note..."
                        className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 placeholder:text-slate-400"
                      />
                      <button
                        onClick={handleAddNote}
                        disabled={addingActivity || !noteText.trim()}
                        className="px-4 py-2.5 bg-slate-900 text-white rounded-xl hover:bg-emerald-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {addingActivity ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                      </button>
                    </div>

                    {activitiesLoading ? (
                      <div className="py-6 text-center">
                        <Loader2 size={16} className="animate-spin mx-auto text-emerald-500" />
                      </div>
                    ) : activities.length === 0 ? (
                      <p className="text-xs text-slate-400 italic py-2">No activity yet</p>
                    ) : (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                        {activities.map(activity => {
                          const IconComponent = ACTIVITY_ICONS[activity.activity_type] || ACTIVITY_ICONS.default
                          return (
                            <div key={activity.id} className="flex gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
                              <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center shrink-0">
                                <IconComponent size={14} className="text-slate-500" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-slate-700">{activity.description}</p>
                                <p className="text-[10px] text-slate-400 font-bold mt-0.5">
                                  {new Date(activity.created_at).toLocaleString()}
                                </p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Footer */}
                {selected.stage !== 'Lost' && selected.stage !== 'Leased' && (
                  <div className="p-6 border-t border-slate-100 bg-slate-50 space-y-3">
                    {showLostInput ? (
                      <div className="space-y-2">
                        <p className="text-[10px] font-black text-red-500 uppercase tracking-widest">Reason for marking lost</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={lostReason}
                            onChange={(e) => setLostReason(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleMarkLost() } }}
                            placeholder="e.g. Found another apartment, unresponsive..."
                            className="flex-1 px-4 py-3 border border-red-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-red-500/20 placeholder:text-slate-400"
                            autoFocus
                          />
                          <button
                            onClick={handleMarkLost}
                            disabled={markingLost || !lostReason.trim()}
                            className="px-4 py-3 bg-red-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-red-500 transition-all flex items-center gap-1.5 disabled:opacity-50"
                          >
                            {markingLost ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
                            Confirm
                          </button>
                          <button
                            onClick={() => { setShowLostInput(false); setLostReason('') }}
                            className="px-3 py-3 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          onClick={() => setShowLostInput(true)}
                          className="px-5 py-3 bg-white border-2 border-slate-200 text-slate-400 font-black text-[10px] uppercase tracking-widest rounded-xl hover:border-red-500 hover:text-red-500 transition-all flex items-center gap-1.5"
                        >
                          <XCircle size={14} /> Mark Lost
                        </button>
                        <button
                          onClick={() => setIsAiDraftOpen(true)}
                          className="px-5 py-3 bg-white border-2 border-violet-200 text-violet-700 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-violet-600 hover:text-white hover:border-violet-600 transition-all flex items-center gap-1.5"
                        >
                          <Sparkles size={14} /> AI Draft
                        </button>
                        <button
                          onClick={() => setIsScheduleTourOpen(true)}
                          className="flex-1 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-lg"
                        >
                          <CalendarPlus size={14} /> Schedule Tour
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Lost Reason Display */}
                {selected.stage === 'Lost' && selected.lost_reason && (
                  <div className="p-6 border-t border-red-100 bg-red-50">
                    <p className="text-[10px] font-black text-red-400 uppercase tracking-widest mb-1">Lost Reason</p>
                    <p className="text-sm font-bold text-red-700">{selected.lost_reason}</p>
                  </div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>

      {/* MODALS */}
      <NewLeadModal
        isOpen={isNewLeadOpen}
        onClose={() => setIsNewLeadOpen(false)}
        onSuccess={(leadId) => {
          setIsNewLeadOpen(false)
          setSelectedId(leadId)
        }}
      />

      <ScheduleTourModal
        isOpen={isScheduleTourOpen}
        onClose={() => setIsScheduleTourOpen(false)}
        onSuccess={() => {
          setIsScheduleTourOpen(false)
        }}
        lead={selected}
      />

      <LeasingAiDraftModal
        isOpen={isAiDraftOpen}
        onClose={() => setIsAiDraftOpen(false)}
        lead={selected}
      />
    </div>
  )
}
