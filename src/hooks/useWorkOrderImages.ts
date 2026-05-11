import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

// ── Types ──

export type WorkOrderImage = {
  id: string
  work_order_id: string
  file_path: string
  file_name: string
  file_size: number
  uploaded_by: string | null
  created_at: string
  url?: string
}

// ── Fetch Images for a Work Order ──

export function useWorkOrderImages(workOrderId: string | null) {
  return useQuery({
    queryKey: ['work-order-images', workOrderId],
    queryFn: async (): Promise<WorkOrderImage[]> => {
      if (!workOrderId) return []

      const { data, error } = await supabase
        .from('work_order_images')
        .select('*')
        .eq('work_order_id', workOrderId)
        .order('created_at', { ascending: true })

      if (error) throw error

      // Generate public URLs for each image using Supabase SDK
      const images = (data ?? []).map(img => {
        const { data: urlData } = supabase.storage
          .from('maintenance-images')
          .getPublicUrl(img.file_path)
        return { ...img, url: urlData.publicUrl }
      })

      return images
    },
    enabled: !!workOrderId,
    staleTime: 60_000,
  })
}

// ── Upload Images to a Work Order ──

export function useUploadWorkOrderImages() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      workOrderId: string
      files: File[]
    }): Promise<WorkOrderImage[]> => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const uploaded: WorkOrderImage[] = []

      for (const file of params.files) {
        // Generate a unique path
        const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
        const uniqueId = crypto.randomUUID()
        const filePath = `${params.workOrderId}/${uniqueId}.${ext}`

        // Upload to storage
        const { error: uploadError } = await supabase.storage
          .from('maintenance-images')
          .upload(filePath, file, {
            contentType: file.type,
            upsert: false,
          })

        if (uploadError) throw uploadError

        // Insert DB record
        const { data: record, error: dbError } = await supabase
          .from('work_order_images')
          .insert({
            work_order_id: params.workOrderId,
            file_path: filePath,
            file_name: file.name,
            file_size: file.size,
            uploaded_by: user.id,
          })
          .select()
          .single()

        if (dbError) throw dbError

        const { data: urlData } = supabase.storage
          .from('maintenance-images')
          .getPublicUrl(filePath)
        uploaded.push({
          ...record,
          url: urlData.publicUrl,
        })
      }

      return uploaded
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['work-order-images', vars.workOrderId] })
      toast.success(`${data.length} image${data.length === 1 ? '' : 's'} uploaded`)
    },
    onError: (err: Error) => {
      toast.error('Image upload failed: ' + err.message)
    },
  })
}
