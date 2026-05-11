'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, CalendarDays, Clock, Plus, Trash2, Loader2, CalendarOff
} from 'lucide-react'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type AvailSlot = {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
}

type BlockedDate = {
  id: string
  date: string
  reason: string | null
}

export default function VendorAvailabilityPage() {
  const router = useRouter()
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<AvailSlot[]>([])
  const [blocked, setBlocked] = useState<BlockedDate[]>([])
  const [saving, setSaving] = useState(false)

  // Add slot form
  const [newDay, setNewDay] = useState(1) // Monday
  const [newStart, setNewStart] = useState('08:00')
  const [newEnd, setNewEnd] = useState('17:00')

  // Add blocked date form
  const [newBlockDate, setNewBlockDate] = useState('')
  const [newBlockReason, setNewBlockReason] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: vendor } = await supabase
      .from('vendors')
      .select('id')
      .ilike('email', user.email!)
      .single()

    if (!vendor) { setLoading(false); return }
    setVendorId(vendor.id)

    const [slotsRes, blockedRes] = await Promise.all([
      supabase
        .from('vendor_availability')
        .select('id, day_of_week, start_time, end_time')
        .eq('vendor_id', vendor.id)
        .order('day_of_week')
        .order('start_time'),
      supabase
        .from('vendor_unavailable_dates')
        .select('id, date, reason')
        .eq('vendor_id', vendor.id)
        .gte('date', new Date().toISOString().split('T')[0])
        .order('date'),
    ])

    if (slotsRes.data) setSlots(slotsRes.data as AvailSlot[])
    if (blockedRes.data) setBlocked(blockedRes.data as BlockedDate[])
    setLoading(false)
  }

  const addSlot = async () => {
    if (!vendorId) return
    if (newStart >= newEnd) { toast.error('End time must be after start time'); return }
    setSaving(true)
    const { error } = await supabase.from('vendor_availability').insert({
      vendor_id: vendorId,
      day_of_week: newDay,
      start_time: newStart,
      end_time: newEnd,
    })
    if (error) {
      if (error.code === '23505') toast.error('You already have a slot at this time')
      else toast.error('Failed to add: ' + error.message)
    } else {
      toast.success('Time block added')
      await fetchData()
    }
    setSaving(false)
  }

  const deleteSlot = async (id: string) => {
    const { error } = await supabase.from('vendor_availability').delete().eq('id', id)
    if (error) toast.error('Failed to delete')
    else {
      setSlots(prev => prev.filter(s => s.id !== id))
      toast.success('Time block removed')
    }
  }

  const addBlockedDate = async () => {
    if (!vendorId || !newBlockDate) return
    setSaving(true)
    const { error } = await supabase.from('vendor_unavailable_dates').insert({
      vendor_id: vendorId,
      date: newBlockDate,
      reason: newBlockReason || null,
    })
    if (error) {
      if (error.code === '23505') toast.error('This date is already blocked')
      else toast.error('Failed to add: ' + error.message)
    } else {
      toast.success('Date blocked')
      setNewBlockDate('')
      setNewBlockReason('')
      await fetchData()
    }
    setSaving(false)
  }

  const deleteBlockedDate = async (id: string) => {
    const { error } = await supabase.from('vendor_unavailable_dates').delete().eq('id', id)
    if (error) toast.error('Failed to delete')
    else {
      setBlocked(prev => prev.filter(b => b.id !== id))
      toast.success('Date unblocked')
    }
  }

  // Group slots by day
  const slotsByDay: Record<number, AvailSlot[]> = {}
  for (const slot of slots) {
    if (!slotsByDay[slot.day_of_week]) slotsByDay[slot.day_of_week] = []
    slotsByDay[slot.day_of_week].push(slot)
  }

  const formatTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 || 12
    return `${hour}:${String(m).padStart(2, '0')} ${ampm}`
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <Loader2 className="animate-spin text-blue-500" size={40} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 pb-20">
      {/* HEADER */}
      <header className="py-6 mb-6 border-b border-slate-800">
        <div className="flex items-center gap-4">
          <Link
            href="/vendor-portal"
            className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700 hover:border-blue-500 transition-colors"
          >
            <ArrowLeft size={18} className="text-blue-400" />
          </Link>
          <div>
            <h1 className="text-xl font-black tracking-tight italic uppercase">
              <CalendarDays size={18} className="inline-block text-blue-500 mr-2" />
              Availability
            </h1>
            <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">
              Set your weekly schedule & blocked dates
            </p>
          </div>
        </div>
      </header>

      {/* WEEKLY SCHEDULE */}
      <section className="mb-8">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
          <Clock size={14} /> Weekly Schedule
        </h2>

        {/* Grid of days */}
        <div className="space-y-3 mb-6">
          {DAY_NAMES.map((dayName, dayIndex) => {
            const daySlots = slotsByDay[dayIndex] || []
            return (
              <div key={dayIndex} className="bg-slate-800 rounded-2xl border border-slate-700 p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-300">{dayName}</span>
                  {daySlots.length === 0 && (
                    <span className="text-[10px] font-bold text-slate-600 uppercase">Off</span>
                  )}
                </div>
                {daySlots.length > 0 && (
                  <div className="space-y-2">
                    {daySlots.map(slot => (
                      <div key={slot.id} className="flex items-center justify-between bg-blue-500/10 rounded-xl px-3 py-2">
                        <span className="text-sm font-bold text-blue-400">
                          {formatTime(slot.start_time)} — {formatTime(slot.end_time)}
                        </span>
                        <button
                          onClick={() => deleteSlot(slot.id)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-all"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ADD SLOT FORM */}
        <div className="bg-slate-800 rounded-2xl border border-dashed border-slate-600 p-4 space-y-3">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Plus size={12} /> Add Time Block
          </p>
          <select
            value={newDay}
            onChange={(e) => setNewDay(Number(e.target.value))}
            className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 outline-none focus:border-blue-500"
          >
            {DAY_NAMES.map((name, i) => (
              <option key={i} value={i}>{name}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Start</label>
              <input
                type="time" value={newStart} onChange={(e) => setNewStart(e.target.value)}
                className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">End</label>
              <input
                type="time" value={newEnd} onChange={(e) => setNewEnd(e.target.value)}
                className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <button
            onClick={addSlot}
            disabled={saving}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase rounded-2xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={14} /> : <Plus size={14} />}
            Add Block
          </button>
        </div>
      </section>

      {/* BLOCKED DATES */}
      <section>
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
          <CalendarOff size={14} /> Blocked Dates
        </h2>

        {blocked.length > 0 && (
          <div className="space-y-2 mb-6">
            {blocked.map(bd => (
              <div key={bd.id} className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-red-400">
                    {new Date(bd.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                  {bd.reason && <p className="text-xs text-slate-500 mt-0.5">{bd.reason}</p>}
                </div>
                <button
                  onClick={() => deleteBlockedDate(bd.id)}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-all"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ADD BLOCKED DATE */}
        <div className="bg-slate-800 rounded-2xl border border-dashed border-slate-600 p-4 space-y-3">
          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Plus size={12} /> Block a Date
          </p>
          <input
            type="date" value={newBlockDate}
            onChange={(e) => setNewBlockDate(e.target.value)}
            min={new Date().toISOString().split('T')[0]}
            className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 outline-none focus:border-blue-500"
          />
          <input
            type="text" value={newBlockReason}
            onChange={(e) => setNewBlockReason(e.target.value)}
            placeholder="Reason (optional)..."
            className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
          />
          <button
            onClick={addBlockedDate}
            disabled={saving || !newBlockDate}
            className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase rounded-2xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
          >
            {saving ? <Loader2 className="animate-spin" size={14} /> : <CalendarOff size={14} />}
            Block Date
          </button>
        </div>
      </section>
    </div>
  )
}
