'use client'

import { useState, useRef, useEffect } from 'react'
import {
  ClipboardCheck, Plus, Search, Filter, Loader2,
  ChevronDown, ChevronUp, Camera, Trash2, Download,
  Share2, Eye, EyeOff, FileText, StickyNote, X,
  Play, CheckCircle, ShieldCheck, AlertCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useInspections,
  useInspectionDetail,
  INSPECTION_TYPE_OPTIONS,
  INSPECTION_STATUS_OPTIONS,
  CONDITION_OPTIONS,
  getTypeColor,
  getStatusColor,
  getConditionColor,
  type Inspection,
  type InspectionArea,
  type InspectionPhoto,
  type InspectionFilters,
  type ConditionRating,
} from '@/hooks/useInspections'
import NewInspectionModal from '@/components/NewInspectionModal'

// ── Color maps for Tailwind classes ──
const TYPE_COLOR_MAP: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
}

const STATUS_COLOR_MAP: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
}

const CONDITION_BG_MAP: Record<string, string> = {
  emerald: 'bg-emerald-600',
  amber: 'bg-amber-500',
  red: 'bg-red-600',
  slate: 'bg-slate-400',
}

const CONDITION_RING_MAP: Record<string, string> = {
  emerald: 'ring-emerald-600',
  amber: 'ring-amber-500',
  red: 'ring-red-600',
  slate: 'ring-slate-400',
}

export default function InspectionsConsolePage() {
  const { isEnabled } = useFeatureFlags()
  const inspectionsEnabled = isEnabled('inspections')

  // ── Filters ──
  const [filterType, setFilterType] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')
  const [searchDebounced, setSearchDebounced] = useState('')

  const filters: InspectionFilters = {
    inspection_type: filterType || undefined,
    status: filterStatus || undefined,
    search: searchDebounced || undefined,
  }

  const {
    inspections, loading,
    createInspection, creating,
    updateStatus, updateArea, uploadPhoto, uploadingPhoto,
    deletePhoto, deleteInspection, deleting,
    updateSharing, updateOverallNotes, downloadReport,
    refresh,
  } = useInspections(filters)

  // ── Selected inspection ──
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = inspections.find(i => i.id === selectedId) || null

  const { areas, loadingDetail } = useInspectionDetail(selectedId)

  // ── Modals / local state ──
  const [isNewOpen, setIsNewOpen] = useState(false)
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set())
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesValue, setNotesValue] = useState('')
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [uploadingAreaId, setUploadingAreaId] = useState<string | null>(null)

  // ── Search debounce ──
  const handleSearch = (value: string) => {
    setSearch(value)
    clearTimeout((window as any).__inspSearchTimer)
    ;(window as any).__inspSearchTimer = setTimeout(() => {
      setSearchDebounced(value)
    }, 400)
  }

  // ── Toggle area accordion ──
  const toggleExpanded = (areaId: string) => {
    setExpandedAreas(prev => {
      const next = new Set(prev)
      if (next.has(areaId)) next.delete(areaId)
      else next.add(areaId)
      return next
    })
  }

  // ── Photo upload handler ──
  const handlePhotoUpload = async (areaId: string, file: File) => {
    if (!selectedId) return
    setUploadingAreaId(areaId)
    try {
      await uploadPhoto({ areaId, inspectionId: selectedId, file })
    } finally {
      setUploadingAreaId(null)
    }
  }

  // ── Photo delete handler ──
  const handleDeletePhoto = async (photo: InspectionPhoto) => {
    if (!confirm('Delete this photo?')) return
    await deletePhoto(photo)
  }

  // ── Delete inspection ──
  const handleDeleteInspection = async () => {
    if (!selected) return
    if (!confirm(`Delete this ${INSPECTION_TYPE_OPTIONS.find(t => t.value === selected.inspection_type)?.label || ''} inspection for ${selected.unit_name}? This cannot be undone.`)) return
    await deleteInspection(selected)
    setSelectedId(null)
  }

  // ── Share toggle ──
  const handleToggleShare = async () => {
    if (!selected) return
    const newShared = !selected.is_shared
    await updateSharing({
      id: selected.id,
      is_shared: newShared,
      shared_with: newShared ? (selected.shared_with.length > 0 ? selected.shared_with : ['Tenant', 'Owner']) : [],
    })
  }

  const handleShareRoleToggle = async (role: string) => {
    if (!selected) return
    const newRoles = selected.shared_with.includes(role)
      ? selected.shared_with.filter(r => r !== role)
      : [...selected.shared_with, role]
    await updateSharing({
      id: selected.id,
      is_shared: newRoles.length > 0,
      shared_with: newRoles,
    })
  }

  // ── Save overall notes ──
  const handleSaveNotes = async () => {
    if (!selected) return
    await updateOverallNotes({ id: selected.id, notes: notesValue })
    setEditingNotes(false)
  }

  // ── Status transitions ──
  const getNextStatus = (current: string) => {
    if (current === 'scheduled') return { next: 'in_progress' as const, label: 'Begin Inspection', icon: Play }
    if (current === 'in_progress') return { next: 'completed' as const, label: 'Complete Inspection', icon: CheckCircle }
    if (current === 'completed') return { next: 'reviewed' as const, label: 'Mark Reviewed', icon: ShieldCheck }
    return null
  }

  // ── Generate PDF ──
  const handleGeneratePdf = async () => {
    if (!selected) return
    setGeneratingPdf(true)
    try {
      const { data: blob, error } = await supabase.functions.invoke('generate-inspection-report', {
        body: { inspection_id: selected.id },
      })

      if (error) {
        let msg = 'Failed to generate report'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        toast.error(msg)
        return
      }

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inspection-${selected.unit_name?.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Report generated and downloaded')
      refresh()
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate report')
    } finally {
      setGeneratingPdf(false)
    }
  }

  // ── Feature flag gate ──
  if (!inspectionsEnabled) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <ClipboardCheck size={48} className="mx-auto text-slate-300 mb-4" />
          <h2 className="text-xl font-black text-slate-900 italic">Inspections & Checklists</h2>
          <p className="text-slate-500 text-sm mt-2">
            This feature is not enabled. Enable the <strong>inspections</strong> flag in Settings to activate.
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
              Inspection <span className="text-emerald-600">Console</span>
            </h1>
            <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
              {inspections.length} Inspection{inspections.length !== 1 ? 's' : ''} &bull; Room-by-Room Checklists
            </p>
          </div>
          <button
            onClick={() => setIsNewOpen(true)}
            className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg hover:-translate-y-1"
          >
            <Plus size={16} /> New Inspection
          </button>
        </div>
      </div>

      {/* CONTROLS BAR */}
      <div className="px-6 md:px-10 pt-6">
        <div className="max-w-[1600px] mx-auto bg-white p-2 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row gap-2">
          <div className="relative min-w-[180px]">
            <Filter className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="w-full pl-10 pr-8 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs uppercase tracking-wider text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer appearance-none"
            >
              <option value="">All Types</option>
              {INSPECTION_TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="relative min-w-[180px]">
            <Filter className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full pl-10 pr-8 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs uppercase tracking-wider text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer appearance-none"
            >
              <option value="">All Statuses</option>
              {INSPECTION_STATUS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search by unit, property, or inspector..."
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 placeholder:text-slate-400"
            />
          </div>
        </div>
      </div>

      {/* TWO-COLUMN LAYOUT */}
      <div className="px-6 md:px-10 py-6">
        <div className="max-w-[1600px] mx-auto flex gap-6" style={{ minHeight: 'calc(100vh - 260px)' }}>

          {/* LEFT: INSPECTION LIST */}
          <div className="w-full md:w-[400px] shrink-0 space-y-3 overflow-y-auto max-h-[calc(100vh-260px)] pr-2">
            {loading ? (
              <div className="py-20 text-center">
                <Loader2 className="animate-spin mx-auto text-emerald-600 mb-4" size={32} />
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading Inspections...</p>
              </div>
            ) : inspections.length === 0 ? (
              <div className="py-20 text-center">
                <ClipboardCheck size={48} className="text-slate-300 mx-auto mb-4" />
                <p className="text-slate-400 font-bold text-sm">
                  {search || filterType || filterStatus ? 'No inspections match your filters' : 'No inspections yet'}
                </p>
                {!search && !filterType && !filterStatus && (
                  <p className="text-slate-400 text-xs mt-1">Create your first inspection to get started.</p>
                )}
              </div>
            ) : (
              inspections.map(insp => {
                const isActive = selectedId === insp.id
                const typeOpt = INSPECTION_TYPE_OPTIONS.find(t => t.value === insp.inspection_type)
                const statusOpt = INSPECTION_STATUS_OPTIONS.find(s => s.value === insp.status)
                const typeColor = TYPE_COLOR_MAP[getTypeColor(insp.inspection_type)] || TYPE_COLOR_MAP.blue
                const statusColor = STATUS_COLOR_MAP[getStatusColor(insp.status)] || STATUS_COLOR_MAP.amber

                return (
                  <button
                    key={insp.id}
                    onClick={() => {
                      setSelectedId(insp.id)
                      setExpandedAreas(new Set())
                      setEditingNotes(false)
                    }}
                    className={`
                      w-full text-left p-4 rounded-2xl border transition-all
                      ${isActive
                        ? 'bg-emerald-50 border-emerald-300 shadow-lg shadow-emerald-900/5'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                      }
                    `}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border ${typeColor}`}>
                        {typeOpt?.label}
                      </span>
                      <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border ${statusColor}`}>
                        {statusOpt?.label}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-slate-900 truncate">{insp.unit_name}</p>
                    <p className="text-[10px] font-bold text-slate-400 truncate">{insp.property_name}</p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-slate-400 font-bold">
                        {insp.scheduled_date
                          ? new Date(insp.scheduled_date + 'T00:00:00').toLocaleDateString()
                          : new Date(insp.created_at).toLocaleDateString()
                        }
                      </span>
                      {insp.overall_score && (
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                          insp.overall_score === 'good' ? 'bg-emerald-100 text-emerald-700' :
                          insp.overall_score === 'fair' ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {insp.overall_score}
                        </span>
                      )}
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
                  <ClipboardCheck size={64} className="text-slate-200 mx-auto mb-4" />
                  <p className="text-slate-400 font-bold text-sm">Select an inspection to view details</p>
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-[2rem] overflow-hidden shadow-sm max-h-[calc(100vh-260px)] overflow-y-auto">

                {/* Detail Header */}
                <div className="bg-slate-50 border-b border-slate-200 p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-xl font-black text-slate-900">{selected.unit_name}</h2>
                        <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border ${TYPE_COLOR_MAP[getTypeColor(selected.inspection_type)] || ''}`}>
                          {INSPECTION_TYPE_OPTIONS.find(t => t.value === selected.inspection_type)?.label}
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-400">{selected.property_name}</p>
                      <div className="flex items-center gap-4 mt-2 text-[10px] text-slate-400 font-bold">
                        <span>Inspector: <span className="text-slate-600">{selected.inspector_name}</span></span>
                        {selected.scheduled_date && (
                          <span>Scheduled: <span className="text-slate-600">{new Date(selected.scheduled_date + 'T00:00:00').toLocaleDateString()}</span></span>
                        )}
                        {selected.completed_date && (
                          <span>Completed: <span className="text-slate-600">{new Date(selected.completed_date).toLocaleDateString()}</span></span>
                        )}
                      </div>
                    </div>

                    {/* Status + Next Action */}
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider border ${STATUS_COLOR_MAP[getStatusColor(selected.status)] || ''}`}>
                        {INSPECTION_STATUS_OPTIONS.find(s => s.value === selected.status)?.label}
                      </span>
                      {(() => {
                        const next = getNextStatus(selected.status)
                        if (!next) return null
                        const Icon = next.icon
                        return (
                          <button
                            onClick={() => updateStatus({ id: selected.id, status: next.next })}
                            className="px-4 py-2 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-emerald-500 transition-all flex items-center gap-1.5 shadow-lg"
                          >
                            <Icon size={14} /> {next.label}
                          </button>
                        )
                      })()}
                    </div>
                  </div>
                </div>

                {/* Area Accordion */}
                <div className="p-6 space-y-3">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">
                    Areas ({areas.length})
                  </h3>

                  {loadingDetail ? (
                    <div className="py-10 text-center">
                      <Loader2 className="animate-spin mx-auto text-emerald-500" size={24} />
                    </div>
                  ) : (
                    areas.map(area => {
                      const isExpanded = expandedAreas.has(area.id)
                      const condOpt = CONDITION_OPTIONS.find(c => c.value === area.condition)
                      const condColor = area.condition ? getConditionColor(area.condition) : 'slate'

                      return (
                        <div key={area.id} className="border border-slate-200 rounded-2xl overflow-hidden">
                          {/* Area Header */}
                          <button
                            onClick={() => toggleExpanded(area.id)}
                            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-3 h-3 rounded-full ${area.condition ? CONDITION_BG_MAP[condColor] || 'bg-slate-300' : 'bg-slate-300'}`} />
                              <span className="text-sm font-bold text-slate-900">{area.area_name}</span>
                              {condOpt && (
                                <span className="text-[9px] font-black uppercase text-slate-400">
                                  {condOpt.label}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {area.photos.length > 0 && (
                                <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <Camera size={10} /> {area.photos.length}
                                </span>
                              )}
                              {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                            </div>
                          </button>

                          {/* Area Content */}
                          {isExpanded && (
                            <div className="border-t border-slate-100 p-4 space-y-4 bg-slate-50/50">

                              {/* Condition Rating */}
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                                  Condition
                                </label>
                                <div className="flex gap-2 flex-wrap">
                                  {CONDITION_OPTIONS.map(opt => {
                                    const isSelected = area.condition === opt.value
                                    const ringColor = CONDITION_RING_MAP[opt.color] || 'ring-slate-400'
                                    return (
                                      <button
                                        key={opt.value}
                                        onClick={() => updateArea({ areaId: area.id, condition: opt.value as ConditionRating })}
                                        disabled={selected.status === 'reviewed'}
                                        className={`
                                          px-4 py-2 rounded-xl text-xs font-bold transition-all border
                                          ${isSelected
                                            ? `ring-2 ${ringColor} border-transparent ${
                                                opt.color === 'emerald' ? 'bg-emerald-100 text-emerald-700' :
                                                opt.color === 'amber' ? 'bg-amber-100 text-amber-700' :
                                                opt.color === 'red' ? 'bg-red-100 text-red-700' :
                                                'bg-slate-100 text-slate-600'
                                              }`
                                            : 'border-slate-200 text-slate-500 hover:border-slate-300 disabled:opacity-50'
                                          }
                                        `}
                                      >
                                        {opt.label}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>

                              {/* Notes */}
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1 block">
                                  Notes
                                </label>
                                <textarea
                                  defaultValue={area.notes || ''}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim()
                                    if (val !== (area.notes || '')) {
                                      updateArea({ areaId: area.id, notes: val })
                                    }
                                  }}
                                  disabled={selected.status === 'reviewed'}
                                  rows={2}
                                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none disabled:opacity-50 disabled:bg-slate-100"
                                  placeholder="Area notes..."
                                />
                              </div>

                              {/* Photos */}
                              <div>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 block">
                                  Photos
                                </label>
                                <div className="grid grid-cols-4 gap-2">
                                  {area.photos.map(photo => (
                                    <PhotoThumbnail
                                      key={photo.id}
                                      photo={photo}
                                      onDelete={() => handleDeletePhoto(photo)}
                                      disabled={selected.status === 'reviewed'}
                                    />
                                  ))}

                                  {/* Add photo */}
                                  {selected.status !== 'reviewed' && (
                                    <label className="aspect-square border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-emerald-400 hover:bg-emerald-50/50 transition-all">
                                      {uploadingAreaId === area.id ? (
                                        <Loader2 size={18} className="animate-spin text-emerald-500" />
                                      ) : (
                                        <>
                                          <Camera size={18} className="text-slate-300" />
                                          <span className="text-[8px] font-black text-slate-300 uppercase">Add</span>
                                        </>
                                      )}
                                      <input
                                        type="file"
                                        className="hidden"
                                        accept="image/jpeg,image/png,image/webp,image/heic"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0]
                                          if (file) handlePhotoUpload(area.id, file)
                                          e.target.value = ''
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>

                {/* Overall Notes */}
                <div className="px-6 pb-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        <StickyNote size={12} /> Overall Notes
                      </label>
                      {!editingNotes && selected.status !== 'reviewed' && (
                        <button
                          onClick={() => { setEditingNotes(true); setNotesValue(selected.overall_notes || '') }}
                          className="text-[10px] font-bold text-emerald-600 hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </div>
                    {editingNotes ? (
                      <div className="space-y-2">
                        <textarea
                          value={notesValue}
                          onChange={(e) => setNotesValue(e.target.value)}
                          rows={3}
                          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none"
                          placeholder="Overall inspection notes..."
                          autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setEditingNotes(false)} className="px-3 py-1.5 text-[10px] font-bold text-slate-400 hover:text-slate-600">
                            Cancel
                          </button>
                          <button onClick={handleSaveNotes} className="px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-bold rounded-lg hover:bg-emerald-500">
                            Save
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600">
                        {selected.overall_notes || <span className="text-slate-300 italic">No notes added</span>}
                      </p>
                    )}
                  </div>
                </div>

                {/* Sharing */}
                <div className="px-6 pb-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selected.is_shared}
                        onChange={handleToggleShare}
                        className="w-4 h-4 accent-emerald-600"
                      />
                      <div className="flex items-center gap-2">
                        <Share2 size={14} className="text-emerald-500" />
                        <span className="text-xs font-bold text-slate-700">Share with portal users</span>
                      </div>
                    </label>

                    {selected.is_shared && (
                      <div className="flex gap-3 pl-7">
                        {['Tenant', 'Owner'].map(role => (
                          <label
                            key={role}
                            className={`
                              flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer transition-all
                              ${selected.shared_with.includes(role)
                                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                                : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-200'
                              }
                            `}
                          >
                            <input
                              type="checkbox"
                              checked={selected.shared_with.includes(role)}
                              onChange={() => handleShareRoleToggle(role)}
                              className="w-3.5 h-3.5 accent-emerald-600"
                            />
                            <Eye size={12} />
                            {role}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Bar */}
                <div className="px-6 pb-6 flex flex-wrap gap-2">
                  <button
                    onClick={handleGeneratePdf}
                    disabled={generatingPdf}
                    className="px-4 py-2.5 bg-slate-900 text-white font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-blue-600 transition-all flex items-center gap-1.5 shadow-lg disabled:opacity-50"
                  >
                    {generatingPdf ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                    {generatingPdf ? 'Generating...' : 'Generate PDF'}
                  </button>

                  {selected.pdf_path && (
                    <button
                      onClick={() => downloadReport(selected)}
                      className="px-4 py-2.5 bg-blue-600 text-white font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-blue-500 transition-all flex items-center gap-1.5"
                    >
                      <Download size={14} /> Download Report
                    </button>
                  )}

                  <button
                    onClick={handleDeleteInspection}
                    disabled={deleting}
                    className="px-4 py-2.5 bg-white border border-red-200 text-red-600 font-black text-[10px] uppercase tracking-wider rounded-xl hover:bg-red-50 transition-all flex items-center gap-1.5 ml-auto"
                  >
                    {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {/* NEW INSPECTION MODAL */}
      <NewInspectionModal
        isOpen={isNewOpen}
        onClose={() => setIsNewOpen(false)}
        onCreate={async (payload) => {
          const id = await createInspection(payload)
          setSelectedId(id)
          return id
        }}
        creating={creating}
      />
    </div>
  )
}

// ── Photo Thumbnail Component ──
function PhotoThumbnail({
  photo,
  onDelete,
  disabled,
}: {
  photo: InspectionPhoto
  onDelete: () => void
  disabled: boolean
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [loadingUrl, setLoadingUrl] = useState(true)

  // Get signed URL on mount
  useEffect(() => {
    supabase.storage
      .from('documents')
      .createSignedUrl(photo.file_path, 300)
      .then(({ data }) => {
        if (data?.signedUrl) setUrl(data.signedUrl)
        setLoadingUrl(false)
      })
  }, [photo.file_path])

  return (
    <div className="aspect-square relative rounded-xl overflow-hidden bg-slate-100 group">
      {loadingUrl ? (
        <div className="w-full h-full flex items-center justify-center">
          <Loader2 size={14} className="animate-spin text-slate-300" />
        </div>
      ) : url ? (
        <img src={url} alt={photo.caption || photo.file_name} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <AlertCircle size={14} className="text-slate-300" />
        </div>
      )}
      {!disabled && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}
