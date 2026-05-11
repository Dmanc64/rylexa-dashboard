import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──

export type NotificationChannel = 'email' | 'sms' | 'push'
export type NotificationCategory = 'rent_reminder' | 'maintenance' | 'lease' | 'payment' | 'announcement'

export type NotificationPreference = {
  id: string
  user_id: string
  channel: NotificationChannel
  category: NotificationCategory
  enabled: boolean
}

export const NOTIFICATION_CATEGORIES: { key: NotificationCategory; label: string; description: string }[] = [
  { key: 'rent_reminder', label: 'Rent & Billing', description: 'Rent due reminders, late fees, balance updates' },
  { key: 'maintenance', label: 'Maintenance', description: 'Work order updates and status changes' },
  { key: 'lease', label: 'Lease', description: 'Lease expiry alerts and renewal reminders' },
  { key: 'payment', label: 'Payments', description: 'Payment received confirmations' },
  { key: 'announcement', label: 'Announcements', description: 'Property-wide announcements from management' },
]

export const NOTIFICATION_CHANNELS: { key: NotificationChannel; label: string }[] = [
  { key: 'email', label: 'Email' },
  { key: 'sms', label: 'SMS' },
]

// ── Hooks ──

/**
 * Fetch the current user's notification preferences.
 * Returns a preference map: { category: { channel: enabled } }
 */
export function useMyPreferences() {
  return useQuery({
    queryKey: ['my-notification-preferences'],
    queryFn: async (): Promise<NotificationPreference[]> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)

      if (error) throw error
      return (data ?? []) as NotificationPreference[]
    },
    staleTime: 60_000, // 1 min
  })
}

/**
 * Toggle a specific notification preference.
 * Creates the row if it doesn't exist (upsert pattern).
 */
export function useUpdatePreference() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      channel,
      category,
      enabled,
    }: {
      channel: NotificationChannel
      category: NotificationCategory
      enabled: boolean
    }) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Atomic upsert to avoid race condition between check-then-insert
      const { error } = await supabase
        .from('notification_preferences')
        .upsert(
          { user_id: user.id, channel, category, enabled },
          { onConflict: 'user_id,channel,category' }
        )
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-notification-preferences'] })
    },
    onError: (err: Error) => {
      toast.error('Failed to update preference: ' + err.message)
    },
  })
}

/**
 * Helper: Check if a specific preference is enabled.
 * Defaults to true if no preference row exists (opt-out model).
 */
export function isPreferenceEnabled(
  preferences: NotificationPreference[],
  channel: NotificationChannel,
  category: NotificationCategory
): boolean {
  const pref = preferences.find(
    p => p.channel === channel && p.category === category
  )
  // If no preference row exists, default to enabled (opt-out model)
  return pref ? pref.enabled : true
}
