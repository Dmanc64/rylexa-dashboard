'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type BillingSettings = {
  id: string
  property_id: string | null
  rent_due_day: number
  grace_period_days: number
  late_fee_type: 'flat' | 'percent'
  late_fee_amount: number
  auto_post_rent: boolean
  auto_post_utilities: boolean
  auto_late_fees: boolean
  updated_at: string
}

export type BillingSettingsUpdate = {
  rent_due_day?: number
  grace_period_days?: number
  late_fee_type?: 'flat' | 'percent'
  late_fee_amount?: number
  auto_post_rent?: boolean
  auto_post_utilities?: boolean
  auto_late_fees?: boolean
}

export function useBillingSettings() {
  const [settings, setSettings] = useState<BillingSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchSettings = useCallback(async () => {
    const { data, error } = await supabase
      .from('billing_settings')
      .select('*')
      .is('property_id', null)
      .single()

    if (!error && data) {
      setSettings({
        id: data.id,
        property_id: data.property_id,
        rent_due_day: data.rent_due_day,
        grace_period_days: data.grace_period_days,
        late_fee_type: data.late_fee_type,
        late_fee_amount: Number(data.late_fee_amount),
        auto_post_rent: data.auto_post_rent,
        auto_post_utilities: data.auto_post_utilities,
        auto_late_fees: data.auto_late_fees,
        updated_at: data.updated_at,
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const saveSettings = useCallback(async (updates: BillingSettingsUpdate) => {
    if (!settings) return

    setSaving(true)
    const { error } = await supabase
      .from('billing_settings')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', settings.id)

    if (!error) {
      setSettings(prev => prev ? { ...prev, ...updates, updated_at: new Date().toISOString() } : null)
    }
    setSaving(false)
    return { error }
  }, [settings])

  return { settings, loading, saving, saveSettings, refresh: fetchSettings }
}
