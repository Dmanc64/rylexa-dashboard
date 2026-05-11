'use client'

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type PolicyCategory =
  | 'pet_policy' | 'parking' | 'guest_policy' | 'noise_quiet_hours'
  | 'trash_recycling' | 'maintenance_procedures' | 'move_in_out'
  | 'amenities' | 'insurance' | 'general_rules' | 'smoking' | 'other'

export const POLICY_CATEGORIES: { value: PolicyCategory; label: string }[] = [
  { value: 'pet_policy', label: 'Pet Policy' },
  { value: 'parking', label: 'Parking' },
  { value: 'guest_policy', label: 'Guest Policy' },
  { value: 'noise_quiet_hours', label: 'Noise / Quiet Hours' },
  { value: 'trash_recycling', label: 'Trash & Recycling' },
  { value: 'maintenance_procedures', label: 'Maintenance Procedures' },
  { value: 'move_in_out', label: 'Move-In / Move-Out' },
  { value: 'amenities', label: 'Amenities' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'general_rules', label: 'General Rules' },
  { value: 'smoking', label: 'Smoking Policy' },
  { value: 'other', label: 'Other' },
]

export type PropertyPolicy = {
  id: string
  property_id: string
  category: PolicyCategory
  title: string
  content: string
  is_active: boolean
  display_order: number
  updated_by: string | null
  created_at: string
  updated_at: string
}

export function usePropertyPolicies(propertyId: string | null) {
  const [policies, setPolicies] = useState<PropertyPolicy[]>([])
  const [loading, setLoading] = useState(true)

  const fetchPolicies = useCallback(async () => {
    if (!propertyId) { setPolicies([]); setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('property_policies')
      .select('*')
      .eq('property_id', propertyId)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Failed to fetch policies:', error.message)
    } else {
      setPolicies(data || [])
    }
    setLoading(false)
  }, [propertyId])

  useEffect(() => { fetchPolicies() }, [fetchPolicies])

  const createPolicy = useCallback(async (policy: {
    property_id: string
    category: PolicyCategory
    title: string
    content: string
  }) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('property_policies')
      .insert({ ...policy, updated_by: user?.id })
      .select()
      .single()

    if (error) throw error
    await fetchPolicies()
    return data
  }, [fetchPolicies])

  const updatePolicy = useCallback(async (id: string, updates: Partial<PropertyPolicy>) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('property_policies')
      .update({ ...updates, updated_by: user?.id })
      .eq('id', id)

    if (error) throw error
    await fetchPolicies()
  }, [fetchPolicies])

  const deletePolicy = useCallback(async (id: string) => {
    const { error } = await supabase
      .from('property_policies')
      .delete()
      .eq('id', id)

    if (error) throw error
    await fetchPolicies()
  }, [fetchPolicies])

  const toggleActive = useCallback(async (id: string, isActive: boolean) => {
    await updatePolicy(id, { is_active: isActive })
  }, [updatePolicy])

  return { policies, loading, createPolicy, updatePolicy, deletePolicy, toggleActive, refetch: fetchPolicies }
}
