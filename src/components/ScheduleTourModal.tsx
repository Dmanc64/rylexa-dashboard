'use client'

import { useState, useEffect } from 'react'
import {
  CalendarPlus, Loader2, Building2, Home,
  Calendar, Clock, User, StickyNote
} from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import AccessibleModal from '@/components/AccessibleModal'
import { useTours, type Lead, type ScheduleTourPayload } from '@/hooks/useLeadsCRM'

type PropertyOption = { id: string; name: string }
type UnitOption = { id: string; name: string }
type StaffOption = { id: string; full_name: string }

interface ScheduleTourModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  lead: Lead | null
}

const DURATION_OPTIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 hour' },
  { value: '90', label: '1.5 hours' },
]

export default function ScheduleTourModal({ isOpen, onClose, onSuccess, lead }: ScheduleTourModalProps) {
  const { scheduleTour, scheduling } = useTours()

  // ── Form state ──
  const [propertyId, setPropertyId] = useState('')
  const [unitId, setUnitId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [duration, setDuration] = useState('30')
  const [staffId, setStaffId] = useState('')
  const [notes, setNotes] = useState('')

  // ── Lookup data ──
  const [properties, setProperties] = useState<PropertyOption[]>([])
  const [units, setUnits] = useState<UnitOption[]>([])
  const [staff, setStaff] = useState<StaffOption[]>([])
  const [loadingProps, setLoadingProps] = useState(false)
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [loadingStaff, setLoadingStaff] = useState(false)

  // Reset form on open and pre-fill from lead
  useEffect(() => {
    if (isOpen) {
      setPropertyId(lead?.interested_property_id || '')
      setUnitId(lead?.interested_unit_id || '')
      setDate('')
      setTime('')
      setDuration('30')
      setStaffId('')
      setNotes('')
      setUnits([])
    }
  }, [isOpen, lead])

  // Fetch properties on open
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    async function load() {
      setLoadingProps(true)
      const { data } = await supabase
        .from('properties')
        .select('id, name')
        .order('name')
      if (!cancelled && data) setProperties(data)
      if (!cancelled) setLoadingProps(false)
    }
    load()
    return () => { cancelled = true }
  }, [isOpen])

  // Fetch staff (Admin + Property Manager profiles) on open
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    async function load() {
      setLoadingStaff(true)
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('role', ['Admin', 'Property Manager'])
        .order('full_name')
      if (!cancelled && data) setStaff(data as StaffOption[])
      if (!cancelled) setLoadingStaff(false)
    }
    load()
    return () => { cancelled = true }
  }, [isOpen])

  // Fetch units when property changes
  useEffect(() => {
    if (!propertyId) { setUnits([]); setUnitId(''); return }
    let cancelled = false
    async function load() {
      setLoadingUnits(true)
      const { data } = await supabase
        .from('units')
        .select('id, name')
        .eq('property_id', propertyId)
        .order('name')
      if (!cancelled && data) setUnits(data)
      if (!cancelled) setLoadingUnits(false)
    }
    load()
    return () => { cancelled = true }
  }, [propertyId])

  const handleSubmit = async () => {
    // Validation
    if (!lead) {
      toast.error('No lead selected. Please select a lead first.')
      return
    }
    if (!propertyId) {
      toast.error('Please select a property')
      return
    }
    if (!date) {
      toast.error('Please select a date')
      return
    }
    if (!time) {
      toast.error('Please select a time')
      return
    }

    const scheduledAt = new Date(`${date}T${time}`).toISOString()

    const payload: ScheduleTourPayload = {
      lead_id: lead.id,
      property_id: propertyId,
      unit_id: unitId || undefined,
      scheduled_at: scheduledAt,
      duration_minutes: parseInt(duration, 10),
      notes: notes.trim() || undefined,
    }

    try {
      await scheduleTour(payload)

      // If a staff member was chosen, update the tour's conducted_by
      // (The hook sets conducted_by to the current user; override if different staff selected)
      // Note: The hook handles auto-advancing the lead to 'Tour Scheduled' stage

      onSuccess()
    } catch {
      // Error handled by hook
    }
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Schedule Tour"
      subtitle={lead ? `Tour for ${lead.first_name} ${lead.last_name}` : 'Schedule a property tour'}
      size="max-w-xl"
      headerBg="bg-violet-50"
      headerTextColor="text-violet-900"
      closeBtnColor="text-violet-400"
    >
      <div className="p-6 space-y-6">

        {/* No lead selected warning */}
        {!lead && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <p className="text-xs font-bold text-amber-700">
              Please select a lead from the pipeline first, then schedule a tour.
            </p>
          </div>
        )}

        {/* Property */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Property <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Building2 size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={propertyId}
              onChange={(e) => { setPropertyId(e.target.value); setUnitId('') }}
              disabled={loadingProps}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="">{loadingProps ? 'Loading...' : 'Select property...'}</option>
              {properties.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Unit (optional) */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Unit <span className="text-slate-300">(optional)</span>
          </label>
          <div className="relative">
            <Home size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              disabled={!propertyId || loadingUnits}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="">
                {!propertyId ? 'Select property first...' : loadingUnits ? 'Loading...' : 'Select unit (optional)...'}
              </option>
              {units.map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
            {loadingUnits && <Loader2 size={16} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-violet-500" />}
          </div>
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Date <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Time <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Clock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500/20"
              />
            </div>
          </div>
        </div>

        {/* Duration */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Duration
          </label>
          <div className="flex gap-2">
            {DURATION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDuration(opt.value)}
                className={`
                  flex-1 px-3 py-2.5 rounded-xl border text-xs font-bold transition-all
                  ${duration === opt.value
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'border-slate-200 text-slate-500 hover:border-violet-300'
                  }
                `}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Staff Member */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Staff Member
          </label>
          <div className="relative">
            <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <select
              value={staffId}
              onChange={(e) => setStaffId(e.target.value)}
              disabled={loadingStaff}
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500/20 bg-white appearance-none cursor-pointer disabled:opacity-50"
            >
              <option value="">{loadingStaff ? 'Loading...' : 'Assign to current user'}</option>
              {staff.map(s => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            Leave blank to assign the tour to yourself.
          </p>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
            Notes
          </label>
          <div className="relative">
            <StickyNote size={16} className="absolute left-4 top-3.5 text-slate-400" />
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Tour notes, special instructions..."
              className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500/20 resize-none"
            />
          </div>
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={scheduling || !lead}
          className="w-full py-4 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {scheduling ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Scheduling...
            </>
          ) : (
            <>
              <CalendarPlus size={16} />
              Schedule Tour
            </>
          )}
        </button>
      </div>
    </AccessibleModal>
  )
}
