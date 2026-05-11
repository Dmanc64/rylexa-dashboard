import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { compressImage } from '@/lib/compress-image'
import { sanitizeFileName, ALLOWED_FILE_TYPES, MAX_FILE_SIZE } from '@/lib/upload-utils'

// ── Types ──────────────────────────────────────────────────
export type InspectionType = 'move_in' | 'move_out' | 'periodic' | 'pre_listing'
export type InspectionStatus = 'scheduled' | 'in_progress' | 'completed' | 'reviewed'
export type ConditionRating = 'good' | 'fair' | 'poor' | 'na'

export type InspectionPhoto = {
  id: string
  area_id: string
  file_path: string
  file_name: string
  file_size: number
  mime_type: string
  caption: string | null
  sort_order: number
  created_at: string
}

export type InspectionArea = {
  id: string
  inspection_id: string
  area_name: string
  condition: ConditionRating | null
  notes: string | null
  sort_order: number
  created_at: string
  // Joined
  photos: InspectionPhoto[]
}

export type Inspection = {
  id: string
  unit_id: string
  lease_id: string | null
  inspection_type: InspectionType
  status: InspectionStatus
  scheduled_date: string | null
  completed_date: string | null
  inspector_id: string
  overall_notes: string | null
  overall_score: string | null
  pdf_path: string | null
  is_shared: boolean
  shared_with: string[]
  created_at: string
  updated_at: string
  // Joined
  unit_name?: string
  property_name?: string
  inspector_name?: string
}

export type InspectionFilters = {
  property_id?: string
  inspection_type?: string
  status?: string
  search?: string
}

export type CreateInspectionPayload = {
  unit_id: string
  lease_id?: string
  inspection_type: InspectionType
  scheduled_date?: string
  areas: string[]
}

// ── Constants ──────────────────────────────────────────────
export const DEFAULT_INSPECTION_AREAS = [
  'Living Room',
  'Kitchen',
  'Master Bedroom',
  'Bedroom 2',
  'Bedroom 3',
  'Bathroom 1',
  'Bathroom 2',
  'Dining Area',
  'Hallway / Entry',
  'Closets / Storage',
  'Laundry Area',
  'Patio / Balcony',
  'Garage',
  'Exterior',
  'HVAC / Water Heater',
]

export const INSPECTION_TYPE_OPTIONS: { value: InspectionType; label: string; color: string }[] = [
  { value: 'move_in', label: 'Move-In', color: 'emerald' },
  { value: 'move_out', label: 'Move-Out', color: 'red' },
  { value: 'periodic', label: 'Periodic', color: 'blue' },
  { value: 'pre_listing', label: 'Pre-Listing', color: 'violet' },
]

export const INSPECTION_STATUS_OPTIONS: { value: InspectionStatus; label: string; color: string }[] = [
  { value: 'scheduled', label: 'Scheduled', color: 'amber' },
  { value: 'in_progress', label: 'In Progress', color: 'blue' },
  { value: 'completed', label: 'Completed', color: 'emerald' },
  { value: 'reviewed', label: 'Reviewed', color: 'violet' },
]

export const CONDITION_OPTIONS: { value: ConditionRating; label: string; color: string }[] = [
  { value: 'good', label: 'Good', color: 'emerald' },
  { value: 'fair', label: 'Fair', color: 'amber' },
  { value: 'poor', label: 'Poor', color: 'red' },
  { value: 'na', label: 'N/A', color: 'slate' },
]

// ── Fetch helpers ──────────────────────────────────────────
async function fetchInspections(filters: InspectionFilters): Promise<Inspection[]> {
  let query = supabase
    .from('inspections')
    .select(`
      *,
      units!unit_id ( name, property_id, properties!property_id ( id, name ) ),
      profiles!inspector_id ( full_name )
    `)
    .order('created_at', { ascending: false })

  if (filters.inspection_type) {
    query = query.eq('inspection_type', filters.inspection_type)
  }
  if (filters.status) {
    query = query.eq('status', filters.status)
  }
  if (filters.search) {
    // Search by unit name or property name — handled client-side since supabase
    // doesn't support ilike on joined columns easily
  }

  const { data, error } = await query

  if (error) throw error

  let results = (data ?? []).map((d: any) => ({
    ...d,
    unit_name: d.units?.name || 'Unknown',
    property_name: d.units?.properties?.name || 'Unknown',
    inspector_name: d.profiles?.full_name || 'Unknown',
  }))

  // Client-side property filter (needs the join)
  if (filters.property_id) {
    results = results.filter((r: any) => r.units?.properties?.id === filters.property_id)
  }

  // Client-side search
  if (filters.search) {
    const term = filters.search.toLowerCase()
    results = results.filter((r: Inspection) =>
      (r.unit_name || '').toLowerCase().includes(term) ||
      (r.property_name || '').toLowerCase().includes(term) ||
      (r.inspector_name || '').toLowerCase().includes(term)
    )
  }

  return results
}

async function fetchInspectionDetail(inspectionId: string): Promise<{ areas: InspectionArea[] }> {
  const { data, error } = await supabase
    .from('inspection_areas')
    .select(`
      *,
      inspection_photos ( * )
    `)
    .eq('inspection_id', inspectionId)
    .order('sort_order', { ascending: true })

  if (error) throw error

  const areas: InspectionArea[] = (data ?? []).map((a: any) => ({
    ...a,
    photos: (a.inspection_photos ?? []).sort((x: any, y: any) => x.sort_order - y.sort_order),
  }))

  return { areas }
}

// ── Create inspection ──────────────────────────────────────
async function createInspection(payload: CreateInspectionPayload) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const status: InspectionStatus = payload.scheduled_date ? 'scheduled' : 'in_progress'

  const { data: inspection, error: insertError } = await supabase
    .from('inspections')
    .insert({
      unit_id: payload.unit_id,
      lease_id: payload.lease_id || null,
      inspection_type: payload.inspection_type,
      status,
      scheduled_date: payload.scheduled_date || null,
      inspector_id: user.id,
    })
    .select('id')
    .single()

  if (insertError) throw new Error('Failed to create inspection: ' + insertError.message)

  // Batch-insert areas
  const areaRows = payload.areas.map((name, i) => ({
    inspection_id: inspection.id,
    area_name: name,
    sort_order: i,
  }))

  const { error: areasError } = await supabase
    .from('inspection_areas')
    .insert(areaRows)

  if (areasError) {
    // Rollback: delete the inspection
    await supabase.from('inspections').delete().eq('id', inspection.id)
    throw new Error('Failed to create areas: ' + areasError.message)
  }

  return inspection.id
}

// ── Update area ────────────────────────────────────────────
async function updateArea({ areaId, condition, notes }: { areaId: string; condition?: ConditionRating; notes?: string }) {
  const update: Record<string, any> = {}
  if (condition !== undefined) update.condition = condition
  if (notes !== undefined) update.notes = notes

  const { error } = await supabase
    .from('inspection_areas')
    .update(update)
    .eq('id', areaId)

  if (error) throw new Error('Failed to update area: ' + error.message)
}

// ── Upload photo ───────────────────────────────────────────
async function uploadPhoto({ areaId, inspectionId, file, caption }: {
  areaId: string
  inspectionId: string
  file: File
  caption?: string
}) {
  // Validate
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    throw new Error('Only images are allowed (JPEG, PNG, WebP, HEIC)')
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error('File too large (max 10MB)')
  }

  // Compress
  const compressed = await compressImage(file)
  const safeName = sanitizeFileName(compressed.name)
  const filePath = `inspections/${inspectionId}/${areaId}/${Date.now()}-${safeName}`

  // Upload to documents bucket
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(filePath, compressed, { contentType: compressed.type })

  if (uploadError) throw new Error('Upload failed: ' + uploadError.message)

  // Get current photo count for sort_order
  const { count } = await supabase
    .from('inspection_photos')
    .select('*', { count: 'exact', head: true })
    .eq('area_id', areaId)

  // Insert metadata row
  const { error: insertError } = await supabase
    .from('inspection_photos')
    .insert({
      area_id: areaId,
      file_path: filePath,
      file_name: safeName,
      file_size: compressed.size,
      mime_type: compressed.type,
      caption: caption?.trim() || null,
      sort_order: (count ?? 0),
    })

  if (insertError) {
    // Rollback: remove uploaded file
    await supabase.storage.from('documents').remove([filePath])
    throw new Error('Failed to save photo: ' + insertError.message)
  }
}

// ── Delete photo ───────────────────────────────────────────
async function deletePhoto(photo: InspectionPhoto) {
  const { error: storageError } = await supabase.storage
    .from('documents')
    .remove([photo.file_path])

  if (storageError) {
    console.warn('Storage delete failed:', storageError.message)
  }

  const { error: dbError } = await supabase
    .from('inspection_photos')
    .delete()
    .eq('id', photo.id)

  if (dbError) throw new Error('Failed to delete photo: ' + dbError.message)
}

// ── Update status ──────────────────────────────────────────
async function updateStatus({ id, status }: { id: string; status: InspectionStatus }) {
  const update: Record<string, any> = { status }

  if (status === 'completed') {
    update.completed_date = new Date().toISOString()

    // Compute overall_score from areas
    const { data: areas } = await supabase
      .from('inspection_areas')
      .select('condition')
      .eq('inspection_id', id)

    if (areas && areas.length > 0) {
      const rated = areas.filter((a: any) => a.condition && a.condition !== 'na')
      const poorCount = rated.filter((a: any) => a.condition === 'poor').length
      const fairCount = rated.filter((a: any) => a.condition === 'fair').length

      if (poorCount > 0) update.overall_score = 'poor'
      else if (fairCount > 0) update.overall_score = 'fair'
      else update.overall_score = 'good'
    }
  }

  const { error } = await supabase
    .from('inspections')
    .update(update)
    .eq('id', id)

  if (error) throw new Error('Failed to update status: ' + error.message)
}

// ── Update sharing ─────────────────────────────────────────
async function updateSharing({ id, is_shared, shared_with }: { id: string; is_shared: boolean; shared_with: string[] }) {
  const { error } = await supabase
    .from('inspections')
    .update({ is_shared, shared_with })
    .eq('id', id)

  if (error) throw new Error('Failed to update sharing: ' + error.message)
}

// ── Update overall notes ───────────────────────────────────
async function updateOverallNotes({ id, notes }: { id: string; notes: string }) {
  const { error } = await supabase
    .from('inspections')
    .update({ overall_notes: notes.trim() || null })
    .eq('id', id)

  if (error) throw new Error('Failed to update notes: ' + error.message)
}

// ── Delete inspection ──────────────────────────────────────
async function deleteInspection(inspection: Inspection) {
  // 1. Collect all photo file paths
  const { data: areas } = await supabase
    .from('inspection_areas')
    .select('id')
    .eq('inspection_id', inspection.id)

  if (areas && areas.length > 0) {
    const areaIds = areas.map((a: any) => a.id)
    const { data: photos } = await supabase
      .from('inspection_photos')
      .select('file_path')
      .in('area_id', areaIds)

    if (photos && photos.length > 0) {
      const paths = photos.map((p: any) => p.file_path)
      await supabase.storage.from('documents').remove(paths)
    }
  }

  // 2. Delete PDF if exists
  if (inspection.pdf_path) {
    await supabase.storage.from('documents').remove([inspection.pdf_path])
  }

  // 3. Delete inspection (CASCADE deletes areas + photos rows)
  const { error } = await supabase
    .from('inspections')
    .delete()
    .eq('id', inspection.id)

  if (error) throw new Error('Failed to delete inspection: ' + error.message)
}

// ── Hooks ──────────────────────────────────────────────────
export function useInspections(filters: InspectionFilters = {}) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['inspections', filters],
    queryFn: () => fetchInspections(filters),
  })

  const createMutation = useMutation({
    mutationFn: createInspection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      toast.success('Inspection created')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const statusMutation = useMutation({
    mutationFn: updateStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      queryClient.invalidateQueries({ queryKey: ['inspection-detail'] })
      toast.success('Status updated')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const areaMutation = useMutation({
    mutationFn: updateArea,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection-detail'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const photoUploadMutation = useMutation({
    mutationFn: uploadPhoto,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection-detail'] })
      toast.success('Photo uploaded')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const photoDeleteMutation = useMutation({
    mutationFn: deletePhoto,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspection-detail'] })
      toast.success('Photo deleted')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteInspection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      toast.success('Inspection deleted')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const shareMutation = useMutation({
    mutationFn: updateSharing,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
      toast.success('Sharing updated')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const notesMutation = useMutation({
    mutationFn: updateOverallNotes,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inspections'] })
    },
    onError: (err: any) => toast.error(err.message),
  })

  const downloadReport = async (inspection: Inspection) => {
    if (!inspection.pdf_path) {
      toast.error('No report has been generated yet')
      return
    }
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(inspection.pdf_path, 60)

    if (error || !data?.signedUrl) {
      toast.error('Could not generate download link')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  return {
    inspections: data ?? [],
    loading: isLoading,
    createInspection: createMutation.mutateAsync,
    creating: createMutation.isPending,
    updateStatus: statusMutation.mutateAsync,
    updateArea: areaMutation.mutateAsync,
    uploadPhoto: photoUploadMutation.mutateAsync,
    uploadingPhoto: photoUploadMutation.isPending,
    deletePhoto: photoDeleteMutation.mutateAsync,
    deleteInspection: deleteMutation.mutateAsync,
    deleting: deleteMutation.isPending,
    updateSharing: shareMutation.mutateAsync,
    updateOverallNotes: notesMutation.mutateAsync,
    downloadReport,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['inspections'] }),
  }
}

// ── Detail hook (separate query) ───────────────────────────
export function useInspectionDetail(inspectionId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ['inspection-detail', inspectionId],
    queryFn: () => fetchInspectionDetail(inspectionId!),
    enabled: !!inspectionId,
  })

  return {
    areas: data?.areas ?? [],
    loadingDetail: isLoading,
  }
}

// ── Helpers ────────────────────────────────────────────────
export function getTypeColor(type: string): string {
  const opt = INSPECTION_TYPE_OPTIONS.find(t => t.value === type)
  return opt?.color || 'slate'
}

export function getStatusColor(status: string): string {
  const opt = INSPECTION_STATUS_OPTIONS.find(s => s.value === status)
  return opt?.color || 'slate'
}

export function getConditionColor(condition: string): string {
  const opt = CONDITION_OPTIONS.find(c => c.value === condition)
  return opt?.color || 'slate'
}
