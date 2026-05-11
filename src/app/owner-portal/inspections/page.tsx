'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  ClipboardCheck, Download, Loader2,
  ChevronDown, ChevronUp, Camera
} from 'lucide-react'
import { toast } from 'sonner'

type InspectionPhoto = {
  id: string
  file_path: string
  file_name: string
  caption: string | null
}

type InspectionArea = {
  id: string
  area_name: string
  condition: string | null
  notes: string | null
  sort_order: number
  photos: InspectionPhoto[]
}

type SharedInspection = {
  id: string
  inspection_type: string
  status: string
  scheduled_date: string | null
  completed_date: string | null
  overall_notes: string | null
  overall_score: string | null
  pdf_path: string | null
  created_at: string
  unit_name: string
  property_name: string
}

const TYPE_LABELS: Record<string, string> = {
  move_in: 'Move-In',
  move_out: 'Move-Out',
  periodic: 'Periodic',
  pre_listing: 'Pre-Listing',
}

const TYPE_COLORS: Record<string, string> = {
  move_in: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  move_out: 'bg-red-50 text-red-700 border-red-200',
  periodic: 'bg-blue-50 text-blue-700 border-blue-200',
  pre_listing: 'bg-violet-50 text-violet-700 border-violet-200',
}

const CONDITION_COLORS: Record<string, string> = {
  good: 'text-emerald-600',
  fair: 'text-amber-600',
  poor: 'text-red-600',
  na: 'text-slate-400',
}

const SCORE_COLORS: Record<string, string> = {
  good: 'bg-emerald-100 text-emerald-700',
  fair: 'bg-amber-100 text-amber-700',
  poor: 'bg-red-100 text-red-700',
}

export default function OwnerInspectionsPage() {
  const [inspections, setInspections] = useState<SharedInspection[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [areas, setAreas] = useState<InspectionArea[]>([])
  const [loadingAreas, setLoadingAreas] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  // Fetch shared inspections (RLS scopes to owner's properties)
  useEffect(() => {
    async function fetchInspections() {
      setLoading(true)
      const { data, error } = await supabase
        .from('inspections')
        .select(`
          id, inspection_type, status, scheduled_date, completed_date,
          overall_notes, overall_score, pdf_path, created_at,
          units!unit_id ( name, properties!property_id ( name ) )
        `)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Failed to fetch inspections:', error.message)
      }

      const results = (data || []).map((d: any) => ({
        ...d,
        unit_name: d.units?.name || 'Unknown',
        property_name: d.units?.properties?.name || 'Unknown',
      }))

      setInspections(results)
      setLoading(false)
    }
    fetchInspections()
  }, [])

  const toggleExpand = async (inspectionId: string) => {
    if (expandedId === inspectionId) {
      setExpandedId(null)
      return
    }

    setExpandedId(inspectionId)
    setLoadingAreas(true)
    setAreas([])

    const { data, error } = await supabase
      .from('inspection_areas')
      .select(`
        id, area_name, condition, notes, sort_order,
        inspection_photos ( id, file_path, file_name, caption )
      `)
      .eq('inspection_id', inspectionId)
      .order('sort_order', { ascending: true })

    if (!error && data) {
      setAreas(
        data.map((a: any) => ({
          ...a,
          photos: (a.inspection_photos || []).sort((x: any, y: any) => x.sort_order - y.sort_order),
        }))
      )
    }
    setLoadingAreas(false)
  }

  const handleDownloadReport = async (insp: SharedInspection) => {
    if (!insp.pdf_path) { toast.error('No report available'); return }
    setDownloadingId(insp.id)
    try {
      const { data, error } = await supabase.storage
        .from('documents')
        .createSignedUrl(insp.pdf_path, 60)
      if (error || !data?.signedUrl) { toast.error('Could not generate download link'); return }
      window.open(data.signedUrl, '_blank')
    } catch {
      toast.error('Download failed')
    } finally {
      setDownloadingId(null)
    }
  }

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-emerald-500" size={40} />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Loading Inspections...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">

      {/* HEADER */}
      <div className="max-w-6xl mx-auto mb-10">
        <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase mb-2">Owner Portal</p>
        <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
          Property <span className="text-emerald-600">Inspections</span>
        </h1>
        <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
          {inspections.length} Report{inspections.length !== 1 ? 's' : ''} &bull; Condition Tracking
        </p>
      </div>

      {/* INSPECTION LIST */}
      {inspections.length === 0 ? (
        <div className="max-w-6xl mx-auto py-20 text-center">
          <ClipboardCheck size={48} className="text-slate-300 mx-auto mb-4" />
          <p className="text-slate-400 font-bold text-sm">No inspections have been shared with you yet.</p>
          <p className="text-slate-400 text-xs mt-1">
            Contact your property manager for inspection reports.
          </p>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto space-y-3">
          {inspections.map(insp => {
            const isExpanded = expandedId === insp.id
            const typeColor = TYPE_COLORS[insp.inspection_type] || TYPE_COLORS.periodic
            const typeLabel = TYPE_LABELS[insp.inspection_type] || insp.inspection_type
            const scoreColor = insp.overall_score ? (SCORE_COLORS[insp.overall_score] || '') : ''

            return (
              <div key={insp.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                {/* Card Header */}
                <button
                  onClick={() => toggleExpand(insp.id)}
                  className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                      <ClipboardCheck size={20} className="text-emerald-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <p className="text-sm font-bold text-slate-900">{insp.unit_name}</p>
                        <span className={`inline-flex px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border ${typeColor}`}>
                          {typeLabel}
                        </span>
                      </div>
                      <p className="text-[10px] font-bold text-slate-400">
                        {insp.property_name} &bull;{' '}
                        {insp.completed_date
                          ? new Date(insp.completed_date).toLocaleDateString()
                          : new Date(insp.created_at).toLocaleDateString()
                        }
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {insp.overall_score && (
                      <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full ${scoreColor}`}>
                        {insp.overall_score}
                      </span>
                    )}
                    {insp.pdf_path && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDownloadReport(insp) }}
                        disabled={downloadingId === insp.id}
                        className="p-2 text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                      >
                        {downloadingId === insp.id
                          ? <Loader2 size={16} className="animate-spin" />
                          : <Download size={16} />
                        }
                      </button>
                    )}
                    {isExpanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                  </div>
                </button>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-slate-100 p-5 space-y-4">
                    {loadingAreas ? (
                      <div className="py-6 text-center">
                        <Loader2 className="animate-spin mx-auto text-emerald-500" size={20} />
                      </div>
                    ) : (
                      <>
                        {insp.overall_notes && (
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Overall Notes</p>
                            <p className="text-xs text-slate-600">{insp.overall_notes}</p>
                          </div>
                        )}

                        <div className="space-y-2">
                          {areas.map(area => (
                            <OwnerAreaDetail key={area.id} area={area} />
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Area Detail Sub-component ──
function OwnerAreaDetail({ area }: { area: InspectionArea }) {
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})
  const condColor = area.condition ? (CONDITION_COLORS[area.condition] || 'text-slate-400') : 'text-slate-400'
  const condLabel = area.condition
    ? (area.condition === 'na' ? 'N/A' : area.condition.charAt(0).toUpperCase() + area.condition.slice(1))
    : 'Not Rated'

  useEffect(() => {
    if (area.photos.length === 0) return
    Promise.all(
      area.photos.map(async (p) => {
        const { data } = await supabase.storage.from('documents').createSignedUrl(p.file_path, 300)
        return { id: p.id, url: data?.signedUrl || '' }
      })
    ).then(results => {
      const map: Record<string, string> = {}
      results.forEach(r => { if (r.url) map[r.id] = r.url })
      setPhotoUrls(map)
    })
  }, [area.photos])

  return (
    <div className="bg-white border border-slate-100 rounded-xl p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-slate-900">{area.area_name}</span>
        <span className={`text-[10px] font-black uppercase ${condColor}`}>{condLabel}</span>
      </div>
      {area.notes && (
        <p className="text-[10px] text-slate-500 mb-2">{area.notes}</p>
      )}
      {area.photos.length > 0 && (
        <div className="flex gap-2 flex-wrap mt-2">
          {area.photos.map(photo => (
            <div key={photo.id} className="w-16 h-16 rounded-lg overflow-hidden bg-slate-100">
              {photoUrls[photo.id] ? (
                <img src={photoUrls[photo.id]} alt={photo.caption || photo.file_name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <Camera size={12} className="text-slate-300" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
