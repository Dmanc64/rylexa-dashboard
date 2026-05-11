'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, sanitizeFileName } from '@/lib/upload-utils'

/**
 * Helper: Create an authenticated Supabase client from the request cookies
 * to identify the currently logged-in user (not from form data).
 */
async function getAuthenticatedUser() {
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set() {
          // Server actions cannot set cookies in this context
        },
        remove() {
          // Server actions cannot remove cookies in this context
        },
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

export async function submitMaintenanceUpdate(formData: FormData) {
  try {
  // ── 1. AUTHENTICATE FROM SESSION (not from form data) ──
  const user = await getAuthenticatedUser()
  if (!user) {
    return { success: false, message: 'Unauthorized: You must be logged in.' }
  }

  // ── 2. GET USER ROLE FROM PROFILES TABLE ──
  // Use service role client for database operations
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return { success: false, message: 'Unauthorized: No profile found for this user.' }
  }

  const isAdmin = profile.role === 'Admin' || profile.role === 'Property Manager'

  // ── 2b. EXTRACT WORK ORDER ID EARLY FOR OWNERSHIP CHECK ──
  const workOrderId = formData.get('workOrderId') as string

  if (!workOrderId || typeof workOrderId !== 'string') {
    return { success: false, message: 'Invalid work order ID.' }
  }

  // ── 2c. OWNERSHIP VERIFICATION FOR NON-ADMIN USERS ──
  if (!isAdmin) {
    const { data: wo } = await supabaseAdmin
      .from('work_orders')
      .select('requester_id, vendor_id, tenant_id')
      .eq('id', workOrderId)
      .single()

    if (!wo) {
      return { success: false, message: 'Work order not found.' }
    }

    // Check if caller is the requester
    let isOwner = wo.requester_id === user.id

    // Check if caller is the assigned vendor (matched by email)
    if (!isOwner && wo.vendor_id && user.email) {
      const { data: vendor } = await supabaseAdmin
        .from('vendors')
        .select('id')
        .ilike('email', user.email)
        .single()

      if (vendor && wo.vendor_id === vendor.id) isOwner = true
    }

    if (!isOwner) {
      return { success: false, message: 'Forbidden: You are not associated with this work order.' }
    }
  }

  // ── 3. EXTRACT & VALIDATE FORM DATA ──
  const status = formData.get('status') as string
  const note = formData.get('note') as string
  const file = formData.get('image') as File | null

  // Validate status against allowed values
  const allowedStatuses = ['Open', 'Assigned', 'In Progress', 'Completed', 'Closed', 'On Hold']
  if (status && !allowedStatuses.includes(status)) {
    return { success: false, message: `Invalid status. Allowed: ${allowedStatuses.join(', ')}` }
  }

  // ── 4. BUILD TICKET UPDATES ──
  const ticketUpdates: Record<string, any> = {}
  if (status) ticketUpdates.status = status

  // ONLY Admin/Property Manager can update these detail fields
  if (isAdmin) {
    const title = formData.get('title') as string
    const description = formData.get('description') as string
    const priority = formData.get('priority') as string
    const location = formData.get('location') as string

    if (title) ticketUpdates.title = title
    if (description) ticketUpdates.description = description
    if (priority) {
      const allowedPriorities = ['Low', 'Normal', 'High', 'Emergency']
      if (allowedPriorities.includes(priority)) {
        ticketUpdates.priority = priority
      }
    }
    if (location) ticketUpdates.location = location

    // ── COST FIELDS (Admin only) ──
    const hoursWorked = formData.get('hours_worked') as string
    const invoiceAmount = formData.get('invoice_amount') as string
    const materialsCost = formData.get('materials_cost') as string

    if (hoursWorked !== null && hoursWorked !== '') {
      const parsed = parseFloat(hoursWorked)
      if (isNaN(parsed)) return { success: false, message: 'Invalid hours worked value.' }
      ticketUpdates.hours_worked = parsed
    }
    if (invoiceAmount !== null && invoiceAmount !== '') {
      const parsed = parseFloat(invoiceAmount)
      if (isNaN(parsed)) return { success: false, message: 'Invalid invoice amount.' }
      ticketUpdates.invoice_amount = parsed
    } else if (invoiceAmount === '') {
      // Admin explicitly cleared the invoice override → set to null
      ticketUpdates.invoice_amount = null
    }
    if (materialsCost !== null && materialsCost !== '') {
      const parsed = parseFloat(materialsCost)
      if (isNaN(parsed)) return { success: false, message: 'Invalid materials cost.' }
      ticketUpdates.materials_cost = parsed
    }

    // Auto-calculate labor cost if hours provided
    if (ticketUpdates.hours_worked !== undefined) {
      const { data: workOrder } = await supabaseAdmin
        .from('work_orders')
        .select('vendor_id')
        .eq('id', workOrderId)
        .single()

      if (workOrder?.vendor_id) {
        const { data: vendor } = await supabaseAdmin
          .from('vendors')
          .select('hourly_rate')
          .eq('id', workOrder.vendor_id)
          .single()

        if (vendor?.hourly_rate) {
          ticketUpdates.labor_cost = ticketUpdates.hours_worked * vendor.hourly_rate
        }
      }
    }

    // Recalculate total cost whenever any cost field changes
    const hasCostChange = ticketUpdates.hours_worked !== undefined
      || ticketUpdates.invoice_amount !== undefined
      || ticketUpdates.materials_cost !== undefined

    if (hasCostChange) {
      // Fetch current values for fields not being updated
      const { data: current } = await supabaseAdmin
        .from('work_orders')
        .select('labor_cost, invoice_amount, materials_cost')
        .eq('id', workOrderId)
        .single()

      const effectiveInvoice = ticketUpdates.invoice_amount !== undefined
        ? ticketUpdates.invoice_amount
        : current?.invoice_amount

      const effectiveLabor = ticketUpdates.labor_cost !== undefined
        ? ticketUpdates.labor_cost
        : (current?.labor_cost ?? 0)

      const effectiveMaterials = ticketUpdates.materials_cost !== undefined
        ? ticketUpdates.materials_cost
        : (current?.materials_cost ?? 0)

      // Total = (invoice override ?? calculated labor) + materials
      const laborForTotal = effectiveInvoice != null ? effectiveInvoice : effectiveLabor
      ticketUpdates.cost = (laborForTotal || 0) + (effectiveMaterials || 0)
    }
  }

  // ── 5. UPDATE THE WORK ORDER ──
  if (Object.keys(ticketUpdates).length > 0) {
    const { error: ticketError } = await supabaseAdmin
      .from('work_orders')
      .update(ticketUpdates)
      .eq('id', workOrderId)

    if (ticketError) {
      return { success: false, message: 'Ticket update failed: ' + ticketError.message }
    }
  }

  // ── 6. HANDLE IMAGE UPLOAD (with validation) ──
  let imageUrl = null
  if (file && file.size > 0) {
    // Validate file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      return {
        success: false,
        message: `Invalid file type "${file.type}". Allowed: JPEG, PNG, WebP, HEIC.`
      }
    }
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return {
        success: false,
        message: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum: 10MB.`
      }
    }

    const safeName = sanitizeFileName(file.name)
    const fileName = `${workOrderId}/${Date.now()}-${safeName}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from('maintenance-images')
      .upload(fileName, file, { contentType: file.type })

    if (uploadError) {
      return { success: false, message: 'Image upload failed: ' + uploadError.message }
    }

    const { data: { publicUrl } } = supabaseAdmin.storage
      .from('maintenance-images')
      .getPublicUrl(fileName)

    imageUrl = publicUrl
  }

  // ── 7. INSERT WORK ORDER UPDATE RECORD (audit trail) ──
  if (note || imageUrl) {
    await supabaseAdmin.from('work_order_updates').insert({
      work_order_id: workOrderId,
      user_id: user.id, // Use the authenticated user's ID, NOT from form data
      note: note || (imageUrl ? 'Uploaded an image' : 'Status Update'),
      image_url: imageUrl
    })
  }

  revalidatePath('/admin/maintenance')
  return { success: true, message: 'Work Order Updated' }
  } catch (err: any) {
    console.error('submitMaintenanceUpdate error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown') }
  }
}
