'use client'

import { X, Loader2 } from 'lucide-react'
import { useVendorDateAvailability } from '@/hooks/useMaintenanceCalendar'

interface ScheduleDatePickerProps {
  label: string
  value: string | null
  onChange: (date: string | null) => void
  vendorId?: string | null
  minDate?: string | null
}

export default function ScheduleDatePicker({ label, value, onChange, vendorId, minDate }: ScheduleDatePickerProps) {
  const { data: availability, isLoading: checkingAvailability } = useVendorDateAvailability(
    vendorId ?? null,
    value ?? null
  )

  return (
    <div>
      <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={value ?? ''}
          min={minDate ?? undefined}
          onChange={e => onChange(e.target.value || null)}
          className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium
                     outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
        />
        {value && (
          <button
            onClick={() => onChange(null)}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
            title="Clear date"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Vendor availability indicator */}
      {vendorId && value && (
        <div className="mt-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
          {checkingAvailability ? (
            <Loader2 size={10} className="animate-spin text-slate-400" />
          ) : availability?.status === 'available' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-600">Available</span>
            </>
          ) : availability?.status === 'blocked' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-red-500" />
              <span className="text-red-600">Unavailable{availability.reason ? ` — ${availability.reason}` : ''}</span>
            </>
          ) : availability?.status === 'off_schedule' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-amber-600">Off schedule</span>
            </>
          ) : availability?.status === 'no_schedule' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-slate-400" />
              <span className="text-slate-500">No schedule set</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
