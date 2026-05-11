'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays, Loader2, MapPin, User } from 'lucide-react'
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameMonth, isSameDay, isToday,
  format, addMonths, subMonths,
} from 'date-fns'
import { useMaintenanceCalendar, type CalendarWorkOrder } from '@/hooks/useMaintenanceCalendar'

const PRIORITY_COLORS: Record<string, string> = {
  Emergency: 'bg-red-500',
  High: 'bg-orange-500',
  Medium: 'bg-blue-500',
  Low: 'bg-slate-400',
}

const PRIORITY_TEXT: Record<string, string> = {
  Emergency: 'text-red-700 bg-red-50 border-red-200',
  High: 'text-orange-700 bg-orange-50 border-orange-200',
  Medium: 'text-blue-700 bg-blue-50 border-blue-200',
  Low: 'text-slate-600 bg-slate-50 border-slate-200',
}

const STATUS_COLORS: Record<string, string> = {
  Open: 'text-blue-600 bg-blue-50',
  Assigned: 'text-indigo-600 bg-indigo-50',
  'In Progress': 'text-amber-600 bg-amber-50',
  Completed: 'text-emerald-600 bg-emerald-50',
  'On Hold': 'text-slate-500 bg-slate-100',
  Done: 'text-emerald-600 bg-emerald-50',
  Closed: 'text-slate-500 bg-slate-100',
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface MaintenanceCalendarProps {
  onSelectWorkOrder: (workOrderId: string) => void
}

export default function MaintenanceCalendar({ onSelectWorkOrder }: MaintenanceCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  const { groupedByDate, loading } = useMaintenanceCalendar(year, month)

  // Generate calendar grid days
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const calendarStart = startOfWeek(monthStart)
  const calendarEnd = endOfWeek(monthEnd)
  const days = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  // Get work orders for selected day
  const selectedDayKey = selectedDay ? format(selectedDay, 'yyyy-MM-dd') : null
  const selectedDayOrders = selectedDayKey ? (groupedByDate[selectedDayKey] ?? []) : []

  return (
    <div className="space-y-4">
      {/* Header: Month Nav */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition"
          >
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-xl font-black text-slate-900 tracking-tight min-w-[180px] text-center">
            {format(currentDate, 'MMMM yyyy')}
          </h2>
          <button
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <button
          onClick={() => {
            setCurrentDate(new Date())
            setSelectedDay(new Date())
          }}
          className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-slate-900
                     bg-slate-100 hover:bg-slate-200 rounded-lg transition"
        >
          Today
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-slate-400" size={24} />
        </div>
      ) : (
        <>
          {/* Day Name Headers */}
          <div className="grid grid-cols-7 gap-px">
            {DAY_NAMES.map(d => (
              <div key={d} className="text-center text-[10px] font-black uppercase tracking-widest text-slate-400 py-2">
                {d}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-2xl overflow-hidden border border-slate-200">
            {days.map(day => {
              const dateKey = format(day, 'yyyy-MM-dd')
              const dayOrders = groupedByDate[dateKey] ?? []
              const inMonth = isSameMonth(day, currentDate)
              const today = isToday(day)
              const selected = selectedDay ? isSameDay(day, selectedDay) : false

              return (
                <button
                  key={dateKey}
                  onClick={() => setSelectedDay(day)}
                  className={`
                    min-h-[80px] md:min-h-[100px] p-1.5 md:p-2 flex flex-col items-start text-left transition-colors
                    ${inMonth ? 'bg-white' : 'bg-slate-50'}
                    ${selected ? 'ring-2 ring-inset ring-blue-500 bg-blue-50/30' : ''}
                    ${today && !selected ? 'bg-emerald-50/50' : ''}
                    hover:bg-slate-50
                  `}
                >
                  {/* Day Number */}
                  <span className={`
                    text-xs font-bold leading-none mb-1
                    ${!inMonth ? 'text-slate-300' : today ? 'text-emerald-600' : 'text-slate-700'}
                    ${today ? 'bg-emerald-100 rounded-full w-6 h-6 flex items-center justify-center' : ''}
                  `}>
                    {format(day, 'd')}
                  </span>

                  {/* Work Order Dots */}
                  {dayOrders.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-auto">
                      {dayOrders.slice(0, 4).map(wo => (
                        <span
                          key={wo.id}
                          className={`w-2 h-2 md:w-2.5 md:h-2.5 rounded-full ${PRIORITY_COLORS[wo.priority] ?? 'bg-slate-400'}`}
                          title={wo.title}
                        />
                      ))}
                      {dayOrders.length > 4 && (
                        <span className="text-[8px] font-black text-slate-400 leading-none self-center">
                          +{dayOrders.length - 4}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Mini labels on desktop */}
                  <div className="hidden md:flex flex-col gap-0.5 w-full mt-1">
                    {dayOrders.slice(0, 2).map(wo => (
                      <div
                        key={wo.id}
                        className={`text-[8px] font-bold truncate px-1 py-0.5 rounded ${PRIORITY_COLORS[wo.priority]?.replace('bg-', 'bg-') ?? 'bg-slate-100'} text-white leading-tight`}
                      >
                        {wo.title}
                      </div>
                    ))}
                    {dayOrders.length > 2 && (
                      <span className="text-[8px] font-bold text-slate-400 px-1">+{dayOrders.length - 2} more</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Selected Day Detail */}
          {selectedDay && (
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <CalendarDays size={14} />
                  {format(selectedDay, 'EEEE, MMMM d, yyyy')}
                </h3>
                <span className="text-[10px] font-bold text-slate-400">
                  {selectedDayOrders.length} work order{selectedDayOrders.length !== 1 ? 's' : ''}
                </span>
              </div>

              {selectedDayOrders.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-slate-400 font-medium">
                  No work orders scheduled for this day
                </div>
              ) : (
                <div className="divide-y divide-slate-50">
                  {selectedDayOrders.map(wo => (
                    <button
                      key={wo.id}
                      onClick={() => onSelectWorkOrder(wo.id)}
                      className="w-full px-4 py-3 flex items-start gap-3 hover:bg-slate-50 transition-colors text-left"
                    >
                      {/* Priority dot */}
                      <span className={`w-3 h-3 rounded-full mt-1 shrink-0 ${PRIORITY_COLORS[wo.priority] ?? 'bg-slate-400'}`} />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-sm text-slate-900 truncate">{wo.title}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border shrink-0 ${PRIORITY_TEXT[wo.priority] ?? ''}`}>
                            {wo.priority}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold shrink-0 ${STATUS_COLORS[wo.status] ?? 'bg-slate-100 text-slate-500'}`}>
                            {wo.status}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium">
                          {wo.units && (
                            <span className="flex items-center gap-1">
                              <MapPin size={10} />
                              {wo.units.properties?.name} — Unit {wo.units.name}
                            </span>
                          )}
                          {wo.vendors ? (
                            <span className="flex items-center gap-1">
                              <User size={10} />
                              {wo.vendors.company_name || wo.vendors.contact_name}
                            </span>
                          ) : (
                            <span className="text-amber-500 font-bold">Unassigned</span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
