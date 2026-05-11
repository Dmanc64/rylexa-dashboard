import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──────────────────────────────────────────────────

export type LeaseClause = {
  title: string
  body: string
  required: boolean
}

export type LeaseTemplateContent = {
  clauses: LeaseClause[]
  pet_addendum: boolean
  parking_addendum: boolean
  utility_responsibility: 'tenant' | 'landlord' | 'split'
}

export type LeaseTemplate = {
  id: string
  name: string
  description: string | null
  property_id: string | null
  content: LeaseTemplateContent
  is_default: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  // Joined
  property_name?: string
}

export type CreateTemplatePayload = {
  name: string
  description?: string
  property_id?: string | null
  content: LeaseTemplateContent
  is_default?: boolean
}

export type UpdateTemplatePayload = {
  id: string
  name?: string
  description?: string | null
  property_id?: string | null
  content?: LeaseTemplateContent
  is_default?: boolean
}

// ── Fetch ──────────────────────────────────────────────────

async function fetchTemplates(): Promise<LeaseTemplate[]> {
  const { data, error } = await supabase
    .from('lease_templates')
    .select(`
      id, name, description, property_id, content, is_default,
      created_by, created_at, updated_at,
      properties ( name )
    `)
    .order('is_default', { ascending: false })
    .order('name', { ascending: true })

  if (error) throw error

  return (data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    property_id: t.property_id,
    content: t.content as LeaseTemplateContent,
    is_default: t.is_default,
    created_by: t.created_by,
    created_at: t.created_at,
    updated_at: t.updated_at,
    property_name: t.properties?.name ?? null,
  }))
}

// ── Hook ───────────────────────────────────────────────────

export function useLeaseTemplates() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['lease-templates'],
    queryFn: fetchTemplates,
  })

  // Create
  const createMutation = useMutation({
    mutationFn: async (payload: CreateTemplatePayload) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('lease_templates')
        .insert({
          name: payload.name,
          description: payload.description?.trim() || null,
          property_id: payload.property_id || null,
          content: payload.content,
          is_default: payload.is_default ?? false,
          created_by: user.id,
        })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lease-templates'] })
      toast.success('Lease template created')
    },
    onError: (err: any) => toast.error('Failed to create template: ' + err.message),
  })

  // Update
  const updateMutation = useMutation({
    mutationFn: async (payload: UpdateTemplatePayload) => {
      const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
      }
      if (payload.name !== undefined) updates.name = payload.name
      if (payload.description !== undefined) updates.description = payload.description?.trim() || null
      if (payload.property_id !== undefined) updates.property_id = payload.property_id || null
      if (payload.content !== undefined) updates.content = payload.content
      if (payload.is_default !== undefined) updates.is_default = payload.is_default

      const { error } = await supabase
        .from('lease_templates')
        .update(updates)
        .eq('id', payload.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lease-templates'] })
      toast.success('Lease template updated')
    },
    onError: (err: any) => toast.error('Failed to update template: ' + err.message),
  })

  // Delete
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('lease_templates')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lease-templates'] })
      toast.success('Lease template deleted')
    },
    onError: (err: any) => toast.error('Failed to delete template: ' + err.message),
  })

  // Set as Default (clears existing default first)
  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      // Clear existing defaults
      const { error: clearError } = await supabase
        .from('lease_templates')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('is_default', true)

      if (clearError) throw clearError

      // Set new default
      const { error } = await supabase
        .from('lease_templates')
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lease-templates'] })
      toast.success('Default template updated')
    },
    onError: (err: any) => toast.error('Failed to set default: ' + err.message),
  })

  return {
    templates: data ?? [],
    loading: isLoading,
    createTemplate: createMutation.mutateAsync,
    creating: createMutation.isPending,
    updateTemplate: updateMutation.mutateAsync,
    updating: updateMutation.isPending,
    deleteTemplate: deleteMutation.mutateAsync,
    deleting: deleteMutation.isPending,
    setDefault: setDefaultMutation.mutateAsync,
    settingDefault: setDefaultMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['lease-templates'] }),
  }
}
