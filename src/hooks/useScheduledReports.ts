import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { toast } from 'sonner'
import type { ReportType } from './useReports'

// ── Types ──

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly'

export type DateRangeType = 'current_month' | 'last_month' | 'last_30_days' | 'last_7_days' | 'custom'

export type ScheduleRecipient = {
  email: string
  name?: string
}

export type ReportSchedule = {
  id: string
  name: string
  report_type: ReportType
  format: 'csv' | 'pdf'
  filters: {
    propertyId?: string
    dateRangeType?: DateRangeType
    dateFrom?: string
    dateTo?: string
    ownerId?: string
  }
  frequency: ScheduleFrequency
  day_of_week: number | null
  day_of_month: number | null
  time_of_day: string
  timezone: string
  recipients: ScheduleRecipient[]
  is_active: boolean
  next_run_at: string | null
  last_run_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export type ScheduleRun = {
  id: string
  schedule_id: string
  status: 'running' | 'completed' | 'failed'
  report_export_id: string | null
  storage_path: string | null
  recipients_sent: ScheduleRecipient[]
  row_count: number | null
  error_details: string | null
  started_at: string
  completed_at: string | null
}

export type CreateSchedulePayload = {
  name: string
  report_type: ReportType
  format: 'csv' | 'pdf'
  filters: ReportSchedule['filters']
  frequency: ScheduleFrequency
  day_of_week?: number | null
  day_of_month?: number | null
  time_of_day: string
  timezone: string
  recipients: ScheduleRecipient[]
}

// ── Constants ──

export const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

export const DATE_RANGE_OPTIONS: { value: DateRangeType; label: string }[] = [
  { value: 'current_month', label: 'Current Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'last_30_days', label: 'Last 30 Days' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'custom', label: 'Custom Range' },
]

export const TIMEZONE_OPTIONS = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
]

export const DAY_OF_WEEK_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

// ── Fetch helpers ──

async function fetchSchedules(): Promise<ReportSchedule[]> {
  const { data, error } = await supabase
    .from('report_schedules')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ReportSchedule[]
}

async function fetchScheduleRuns(scheduleId: string): Promise<ScheduleRun[]> {
  const { data, error } = await supabase
    .from('report_schedule_runs')
    .select('*')
    .eq('schedule_id', scheduleId)
    .order('started_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return (data ?? []) as ScheduleRun[]
}

async function computeNextRun(
  frequency: string,
  dayOfWeek: number | null,
  dayOfMonth: number | null,
  timeOfDay: string,
  timezone: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('compute_next_run_at', {
    p_frequency: frequency,
    p_day_of_week: dayOfWeek,
    p_day_of_month: dayOfMonth,
    p_time_of_day: timeOfDay,
    p_timezone: timezone,
    p_from_time: new Date().toISOString(),
  })
  if (error) throw error
  return data as string | null
}

// ── Query hooks ──

export function useScheduledReports() {
  return useQuery({
    queryKey: ['report-schedules'],
    queryFn: fetchSchedules,
  })
}

export function useScheduleRuns(scheduleId: string | null) {
  return useQuery({
    queryKey: ['schedule-runs', scheduleId],
    queryFn: () => fetchScheduleRuns(scheduleId!),
    enabled: !!scheduleId,
  })
}

// ── Mutations ──

export function useScheduleMutations() {
  const qc = useQueryClient()

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['report-schedules'] })
    qc.invalidateQueries({ queryKey: ['schedule-runs'] })
  }

  const createSchedule = useMutation({
    mutationFn: async (payload: CreateSchedulePayload) => {
      const { data: user } = await supabase.auth.getUser()

      const nextRunAt = await computeNextRun(
        payload.frequency,
        payload.day_of_week ?? null,
        payload.day_of_month ?? null,
        payload.time_of_day,
        payload.timezone,
      )

      const { data, error } = await supabase
        .from('report_schedules')
        .insert({
          name: payload.name,
          report_type: payload.report_type,
          format: payload.format,
          filters: payload.filters,
          frequency: payload.frequency,
          day_of_week: payload.frequency === 'weekly' ? (payload.day_of_week ?? 1) : null,
          day_of_month: payload.frequency === 'monthly' ? (payload.day_of_month ?? 1) : null,
          time_of_day: payload.time_of_day,
          timezone: payload.timezone,
          recipients: payload.recipients,
          is_active: true,
          next_run_at: nextRunAt,
          created_by: user.user?.id,
        })
        .select('id')
        .single()

      if (error) throw error
      return data.id as string
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Schedule created')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateSchedule = useMutation({
    mutationFn: async ({
      id,
      ...changes
    }: Partial<CreateSchedulePayload> & { id: string }) => {
      const updates: Record<string, any> = {}

      if (changes.name !== undefined) updates.name = changes.name
      if (changes.report_type !== undefined) updates.report_type = changes.report_type
      if (changes.format !== undefined) updates.format = changes.format
      if (changes.filters !== undefined) updates.filters = changes.filters
      if (changes.frequency !== undefined) updates.frequency = changes.frequency
      if (changes.time_of_day !== undefined) updates.time_of_day = changes.time_of_day
      if (changes.timezone !== undefined) updates.timezone = changes.timezone
      if (changes.recipients !== undefined) updates.recipients = changes.recipients

      if (changes.frequency !== undefined) {
        updates.day_of_week = changes.frequency === 'weekly' ? (changes.day_of_week ?? 1) : null
        updates.day_of_month = changes.frequency === 'monthly' ? (changes.day_of_month ?? 1) : null
      } else {
        if (changes.day_of_week !== undefined) updates.day_of_week = changes.day_of_week
        if (changes.day_of_month !== undefined) updates.day_of_month = changes.day_of_month
      }

      // Recompute next_run_at
      const freq = changes.frequency || updates.frequency
      if (freq) {
        const nextRunAt = await computeNextRun(
          freq,
          updates.day_of_week ?? changes.day_of_week ?? null,
          updates.day_of_month ?? changes.day_of_month ?? null,
          changes.time_of_day ?? updates.time_of_day ?? '08:00',
          changes.timezone ?? updates.timezone ?? 'America/Los_Angeles',
        )
        updates.next_run_at = nextRunAt
      }

      const { error } = await supabase
        .from('report_schedules')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Schedule updated')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteSchedule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('report_schedules')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      invalidateAll()
      toast.success('Schedule deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleSchedule = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const updates: Record<string, any> = { is_active }

      if (is_active) {
        // Fetch schedule to recompute next_run_at
        const { data: schedule } = await supabase
          .from('report_schedules')
          .select('frequency, day_of_week, day_of_month, time_of_day, timezone')
          .eq('id', id)
          .single()

        if (schedule) {
          const nextRunAt = await computeNextRun(
            schedule.frequency,
            schedule.day_of_week,
            schedule.day_of_month,
            schedule.time_of_day,
            schedule.timezone,
          )
          updates.next_run_at = nextRunAt
        }
      }

      const { error } = await supabase
        .from('report_schedules')
        .update(updates)
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      invalidateAll()
      toast.success(vars.is_active ? 'Schedule activated' : 'Schedule paused')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const triggerNow = useMutation({
    mutationFn: async (scheduleId: string) => {
      const { data: result, error } = await supabase.functions.invoke('run-scheduled-reports', {
        body: { schedule_ids: [scheduleId] },
      })

      if (error) {
        let msg = error.message || 'Unknown error'
        if (error instanceof FunctionsHttpError) {
          const errBody = await error.context.json().catch(() => null)
          msg = errBody?.error || msg
        }
        throw new Error(msg)
      }

      return result
    },
    onSuccess: (data) => {
      invalidateAll()
      if (data.succeeded > 0) toast.success('Report generated and emailed')
      else if (data.failed > 0) toast.error('Report generation failed')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return {
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleSchedule,
    triggerNow,
  }
}
