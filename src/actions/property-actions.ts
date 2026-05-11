'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, sanitizeFileName } from '@/lib/upload-utils'

async function verifyManagement(): Promise<{ authorized: boolean; message?: string }> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { authorized: false, message: 'Not authenticated.' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile || !['Admin', 'Property Manager'].includes(profile.role)) {
    return { authorized: false, message: 'Unauthorized. Only Admin or Property Manager can manage property images.' }
  }
  return { authorized: true }
}

export async function uploadPropertyImage(formData: FormData) {
  const propertyId = formData.get('propertyId') as string
  const file = formData.get('image') as File | null

  if (!propertyId) {
    return { success: false, message: 'Property ID is required.' }
  }

  const auth = await verifyManagement()
  if (!auth.authorized) return { success: false, message: auth.message! }

  if (!file || file.size === 0) {
    return { success: false, message: 'No image file provided.' }
  }
  if (!ALLOWED_FILE_TYPES.includes(file.type)) {
    return { success: false, message: 'Invalid file type. Allowed: JPEG, PNG, WebP, HEIC.' }
  }
  if (file.size > MAX_FILE_SIZE) {
    return { success: false, message: 'File too large. Maximum size is 10MB.' }
  }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Upload to storage
  const safeName = sanitizeFileName(file.name)
  const fileName = `${propertyId}/${Date.now()}-${safeName}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from('property-images')
    .upload(fileName, file, { contentType: file.type })

  if (uploadError) {
    return { success: false, message: 'Upload failed: ' + uploadError.message }
  }

  const { data: { publicUrl } } = supabaseAdmin.storage
    .from('property-images')
    .getPublicUrl(fileName)

  // Update property record with image URL
  const { error: updateError } = await supabaseAdmin
    .from('properties')
    .update({ image_url: publicUrl })
    .eq('id', propertyId)

  if (updateError) {
    return { success: false, message: 'Failed to save image URL: ' + updateError.message }
  }

  revalidatePath('/admin/properties')
  revalidatePath(`/admin/properties/${propertyId}`)
  revalidatePath('/owner-portal/properties')

  return { success: true, imageUrl: publicUrl }
}

export async function removePropertyImage(propertyId: string) {
  if (!propertyId) {
    return { success: false, message: 'Property ID is required.' }
  }

  const auth = await verifyManagement()
  if (!auth.authorized) return { success: false, message: auth.message! }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  // Get current image URL to delete from storage
  const { data: property } = await supabaseAdmin
    .from('properties')
    .select('image_url')
    .eq('id', propertyId)
    .single()

  if (property?.image_url) {
    // Extract storage path from public URL
    const urlParts = property.image_url.split('/storage/v1/object/public/property-images/')
    if (urlParts[1]) {
      await supabaseAdmin.storage
        .from('property-images')
        .remove([urlParts[1]])
    }
  }

  // Clear image_url in database
  const { error } = await supabaseAdmin
    .from('properties')
    .update({ image_url: null })
    .eq('id', propertyId)

  if (error) {
    return { success: false, message: 'Failed to remove image: ' + error.message }
  }

  revalidatePath('/admin/properties')
  revalidatePath(`/admin/properties/${propertyId}`)
  revalidatePath('/owner-portal/properties')

  return { success: true }
}
