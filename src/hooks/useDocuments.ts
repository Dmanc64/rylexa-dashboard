import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { sanitizeFileName, DOCUMENT_ALLOWED_TYPES, DOCUMENT_MAX_FILE_SIZE } from '@/lib/upload-utils'

// ── Types ──────────────────────────────────────────────────
export type DocumentType = 'lease_agreement' | 'notice' | 'inspection' | 'receipt' | 'photo' | 'insurance' | 'tax' | 'other'
export type EntityType = 'property' | 'unit' | 'lease' | 'tenant' | 'work_order'

export type Document = {
  id: string
  title: string
  document_type: DocumentType
  entity_type: EntityType
  entity_id: string
  file_path: string
  file_name: string
  file_size: number
  mime_type: string
  notes: string | null
  is_shared: boolean
  shared_with: string[]
  uploaded_by: string
  created_at: string
  // Joined
  uploader_name?: string
}

export type DocumentFilters = {
  document_type?: string
  entity_type?: string
  search?: string
}

export type UploadPayload = {
  file: File
  title: string
  document_type: string
  entity_type: string
  entity_id: string
  notes?: string
  is_shared: boolean
  shared_with: string[]
}

// ── Document type labels & colors ──────────────────────────
export const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string; color: string }[] = [
  { value: 'lease_agreement', label: 'Lease Agreement', color: 'blue' },
  { value: 'notice', label: 'Notice', color: 'amber' },
  { value: 'inspection', label: 'Inspection', color: 'violet' },
  { value: 'receipt', label: 'Receipt', color: 'emerald' },
  { value: 'photo', label: 'Photo', color: 'orange' },
  { value: 'insurance', label: 'Insurance', color: 'cyan' },
  { value: 'tax', label: 'Tax', color: 'rose' },
  { value: 'other', label: 'Other', color: 'slate' },
]

export const ENTITY_TYPE_OPTIONS: { value: EntityType; label: string }[] = [
  { value: 'property', label: 'Property' },
  { value: 'unit', label: 'Unit' },
  { value: 'lease', label: 'Lease' },
  { value: 'tenant', label: 'Tenant' },
  { value: 'work_order', label: 'Work Order' },
]

// ── Fetch ──────────────────────────────────────────────────
async function fetchDocuments(filters: DocumentFilters): Promise<Document[]> {
  let query = supabase
    .from('documents')
    .select('*, profiles!uploaded_by(full_name)')
    .order('created_at', { ascending: false })

  if (filters.document_type) {
    query = query.eq('document_type', filters.document_type)
  }
  if (filters.entity_type) {
    query = query.eq('entity_type', filters.entity_type)
  }
  if (filters.search) {
    query = query.ilike('title', `%${filters.search}%`)
  }

  const { data, error } = await query

  if (error) throw error

  return (data ?? []).map((d: any) => ({
    ...d,
    uploader_name: d.profiles?.full_name || 'Unknown',
  }))
}

// ── Upload ─────────────────────────────────────────────────
async function uploadDocument(payload: UploadPayload) {
  const { file, title, document_type, entity_type, entity_id, notes, is_shared, shared_with } = payload

  // Validate
  if (file.size > DOCUMENT_MAX_FILE_SIZE) {
    throw new Error('File too large (max 25MB)')
  }
  if (!DOCUMENT_ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Unsupported file type. Allowed: PDF, images, Word, Excel, text.')
  }

  const safeName = sanitizeFileName(file.name)
  const filePath = `${entity_type}/${entity_id}/${Date.now()}-${safeName}`

  // Upload to storage
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(filePath, file, { contentType: file.type })

  if (uploadError) throw new Error('Storage upload failed: ' + uploadError.message)

  // Insert metadata row
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { error: insertError } = await supabase
    .from('documents')
    .insert({
      title,
      document_type,
      entity_type,
      entity_id,
      file_path: filePath,
      file_name: safeName,
      file_size: file.size,
      mime_type: file.type,
      notes: notes?.trim() || null,
      is_shared,
      shared_with,
      uploaded_by: user.id,
    })

  if (insertError) {
    // Rollback: delete orphaned storage file
    await supabase.storage.from('documents').remove([filePath])
    throw new Error('Failed to save document: ' + insertError.message)
  }
}

// ── Delete ─────────────────────────────────────────────────
async function deleteDocument(doc: Document) {
  // Delete storage file first
  const { error: storageError } = await supabase.storage
    .from('documents')
    .remove([doc.file_path])

  if (storageError) {
    console.warn('Storage delete failed:', storageError.message)
    // Continue to delete metadata even if storage fails
  }

  const { error: dbError } = await supabase
    .from('documents')
    .delete()
    .eq('id', doc.id)

  if (dbError) throw new Error('Failed to delete document: ' + dbError.message)
}

// ── Share update ───────────────────────────────────────────
async function updateSharing({ id, is_shared, shared_with }: { id: string; is_shared: boolean; shared_with: string[] }) {
  const { error } = await supabase
    .from('documents')
    .update({ is_shared, shared_with })
    .eq('id', id)

  if (error) throw new Error('Failed to update sharing: ' + error.message)
}

// ── Hook ───────────────────────────────────────────────────
export function useDocuments(filters: DocumentFilters = {}) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['documents', filters],
    queryFn: () => fetchDocuments(filters),
  })

  const uploadMutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      toast.success('Document uploaded successfully')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      toast.success('Document deleted')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const shareMutation = useMutation({
    mutationFn: updateSharing,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] })
      toast.success('Sharing updated')
    },
    onError: (err: any) => toast.error(err.message),
  })

  const downloadDocument = async (doc: Document) => {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(doc.file_path, 60)

    if (error || !data?.signedUrl) {
      toast.error('Could not generate download link')
      return
    }
    window.open(data.signedUrl, '_blank')
  }

  return {
    documents: data ?? [],
    loading: isLoading,
    upload: uploadMutation.mutateAsync,
    uploading: uploadMutation.isPending,
    deleteDoc: deleteMutation.mutateAsync,
    deleting: deleteMutation.isPending,
    updateSharing: shareMutation.mutateAsync,
    downloadDocument,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['documents'] }),
  }
}

// ── Helpers ────────────────────────────────────────────────
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export function getDocTypeColor(type: string): string {
  const opt = DOCUMENT_TYPE_OPTIONS.find(t => t.value === type)
  return opt?.color || 'slate'
}
