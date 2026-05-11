'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { ALLOWED_FILE_TYPES, MAX_FILE_SIZE, sanitizeFileName } from '@/lib/upload-utils'

/**
 * Authenticate the calling user from session cookies.
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
        set() {},
        remove() {},
      },
    }
  )

  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

/**
 * Vendor accepts or rejects an assigned work order.
 *
 * Accept: status → 'In Progress', notifies admin + tenant
 * Reject: status → 'Open', clears vendor_id, notifies admin
 */
export async function respondToWorkOrder(
  workOrderId: string,
  action: 'accept' | 'reject'
) {
  try {
    // ── 1. AUTHENTICATE ──
    const user = await getAuthenticatedUser()
    if (!user) return { success: false, message: 'Unauthorized: You must be logged in.' }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // ── 2. FIND VENDOR RECORD BY EMAIL (case-insensitive) ──
    const { data: vendor } = await supabaseAdmin
      .from('vendors')
      .select('id, company_name, contact_name')
      .ilike('email', user.email ?? '')
      .single()

    if (!vendor) {
      return { success: false, message: 'No vendor record found for your email.' }
    }

    // ── 3. FETCH WORK ORDER & VERIFY OWNERSHIP ──
    const { data: workOrder } = await supabaseAdmin
      .from('work_orders')
      .select('id, title, vendor_id, tenant_id, status')
      .eq('id', workOrderId)
      .single()

    if (!workOrder) {
      return { success: false, message: 'Work order not found.' }
    }
    if (workOrder.vendor_id !== vendor.id) {
      return { success: false, message: 'This work order is not assigned to you.' }
    }
    if (workOrder.status !== 'Assigned') {
      return { success: false, message: 'This work order is not awaiting your response.' }
    }

    const vendorDisplayName = vendor.company_name || vendor.contact_name || 'Vendor'

    // ── 4. HANDLE ACCEPT ──
    if (action === 'accept') {
      const { error: updateError } = await supabaseAdmin
        .from('work_orders')
        .update({ status: 'In Progress' })
        .eq('id', workOrderId)

      if (updateError) {
        return { success: false, message: 'Failed to update work order: ' + updateError.message }
      }

      // Notify admin dashboard
      await supabaseAdmin.from('system_activity').insert({
        event_type: 'VENDOR_ACCEPTED',
        title: 'Vendor Accepted Work Order',
        description: `${vendorDisplayName} accepted: ${workOrder.title}`,
        actor_name: vendorDisplayName,
        related_entity_id: workOrderId,
      })

      // Notify tenant (if tenant exists)
      if (workOrder.tenant_id) {
        await supabaseAdmin.from('system_activity').insert({
          event_type: 'TENANT_REPAIR_UPDATE',
          title: 'Your Repair Request Was Accepted',
          description: `${vendorDisplayName} has accepted your repair request: ${workOrder.title}`,
          actor_name: vendorDisplayName,
          related_entity_id: workOrderId,
        })
      }

      revalidatePath('/vendor-portal')
      return { success: true, message: 'Work order accepted' }
    }

    // ── 5. HANDLE REJECT ──
    const { error: rejectError } = await supabaseAdmin
      .from('work_orders')
      .update({ status: 'Open', vendor_id: null })
      .eq('id', workOrderId)

    if (rejectError) {
      return { success: false, message: 'Failed to reject work order: ' + rejectError.message }
    }

    // Notify admin dashboard
    await supabaseAdmin.from('system_activity').insert({
      event_type: 'VENDOR_REJECTED',
      title: 'Vendor Rejected Work Order',
      description: `${vendorDisplayName} rejected: ${workOrder.title}`,
      actor_name: vendorDisplayName,
      related_entity_id: workOrderId,
    })

    revalidatePath('/vendor-portal')
    return { success: true, message: 'Work order rejected' }
  } catch (err: any) {
    console.error('respondToWorkOrder error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown') }
  }
}

/**
 * Vendor submits an update note (with optional photo) on a work order.
 * Inserts into work_order_updates table and logs to system_activity.
 */
export async function submitVendorUpdate(formData: FormData) {
  try {
    // ── 1. AUTHENTICATE ──
    const user = await getAuthenticatedUser()
    if (!user) return { success: false, message: 'Unauthorized: You must be logged in.' }

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } }
    )

    // ── 2. FIND VENDOR RECORD BY EMAIL (case-insensitive) ──
    const { data: vendor } = await supabaseAdmin
      .from('vendors')
      .select('id, company_name, contact_name, hourly_rate')
      .ilike('email', user.email ?? '')
      .single()

    if (!vendor) {
      return { success: false, message: 'No vendor record found for your email.' }
    }

    // ── 3. EXTRACT FORM DATA ──
    const workOrderId = formData.get('workOrderId') as string
    const note = formData.get('note') as string
    const file = formData.get('image') as File | null
    const hoursWorked = formData.get('hours_worked') as string
    const materialsCost = formData.get('materials_cost') as string

    if (!workOrderId) {
      return { success: false, message: 'Missing work order ID.' }
    }

    // ── 4. VERIFY VENDOR OWNS THIS WORK ORDER ──
    const { data: workOrder } = await supabaseAdmin
      .from('work_orders')
      .select('id, title, vendor_id')
      .eq('id', workOrderId)
      .single()

    if (!workOrder) {
      return { success: false, message: 'Work order not found.' }
    }
    if (workOrder.vendor_id !== vendor.id) {
      return { success: false, message: 'This work order is not assigned to you.' }
    }

    // ── 5. VALIDATE & UPLOAD IMAGE ──
    let imageUrl: string | null = null
    if (file && file.size > 0) {
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        return {
          success: false,
          message: `Invalid file type "${file.type}". Allowed: JPEG, PNG, WebP, HEIC.`
        }
      }
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

    // ── 6. UPDATE COST FIELDS (if vendor logged hours or materials) ──
    const hasHours = hoursWorked !== null && hoursWorked !== ''
    const hasMaterials = materialsCost !== null && materialsCost !== ''

    if (hasHours || hasMaterials) {
      const costUpdates: Record<string, any> = {}

      if (hasHours) {
        const parsedHours = parseFloat(hoursWorked)
        if (isNaN(parsedHours) || parsedHours < 0) {
          return { success: false, message: 'Invalid hours worked value.' }
        }
        costUpdates.hours_worked = parsedHours

        // Auto-calculate labor cost from vendor hourly_rate
        if (vendor.hourly_rate) {
          costUpdates.labor_cost = parsedHours * vendor.hourly_rate
        }
      }

      if (hasMaterials) {
        const parsedMaterials = parseFloat(materialsCost)
        if (isNaN(parsedMaterials) || parsedMaterials < 0) {
          return { success: false, message: 'Invalid materials cost.' }
        }
        costUpdates.materials_cost = parsedMaterials
      }

      // Recalculate total cost
      const { data: current } = await supabaseAdmin
        .from('work_orders')
        .select('labor_cost, invoice_amount, materials_cost')
        .eq('id', workOrderId)
        .single()

      const effectiveInvoice = current?.invoice_amount
      const effectiveLabor = costUpdates.labor_cost ?? current?.labor_cost ?? 0
      const effectiveMaterials = costUpdates.materials_cost ?? current?.materials_cost ?? 0

      // Total = (invoice override ?? calculated labor) + materials
      const laborForTotal = effectiveInvoice != null ? effectiveInvoice : effectiveLabor
      costUpdates.cost = (laborForTotal || 0) + (effectiveMaterials || 0)

      // Flag for admin review — vendor-submitted costs need approval
      costUpdates.cost_pending_review = true

      const { error: costError } = await supabaseAdmin
        .from('work_orders')
        .update(costUpdates)
        .eq('id', workOrderId)

      if (costError) {
        return { success: false, message: 'Failed to update costs: ' + costError.message }
      }
    }

    // ── 7. INSERT UPDATE RECORD ──
    if (!note && !imageUrl && !hasHours && !hasMaterials) {
      return { success: false, message: 'Please add a note, photo, hours, or materials.' }
    }

    // Build a descriptive note for the audit record
    let auditNote = note || ''
    if (!auditNote && imageUrl) auditNote = 'Uploaded a photo'
    if (hasHours) {
      const hoursStr = `${parseFloat(hoursWorked)} hrs`
      const rateStr = vendor.hourly_rate ? ` @ $${vendor.hourly_rate}/hr` : ''
      auditNote = auditNote ? `${auditNote} | Logged ${hoursStr}${rateStr}` : `Logged ${hoursStr}${rateStr}`
    }
    if (hasMaterials) {
      auditNote = auditNote ? `${auditNote} | Materials: $${parseFloat(materialsCost)}` : `Materials: $${parseFloat(materialsCost)}`
    }
    if (!auditNote) auditNote = 'Update'

    await supabaseAdmin.from('work_order_updates').insert({
      work_order_id: workOrderId,
      user_id: user.id,
      note: auditNote,
      image_url: imageUrl,
    })

    // ── 8. LOG TO SYSTEM ACTIVITY ──
    const vendorDisplayName = vendor.company_name || vendor.contact_name || 'Vendor'
    await supabaseAdmin.from('system_activity').insert({
      event_type: 'VENDOR_UPDATE',
      title: 'Vendor Posted Update',
      description: `${vendorDisplayName} added an update to: ${workOrder.title}`,
      actor_name: vendorDisplayName,
      related_entity_id: workOrderId,
    })

    revalidatePath('/vendor-portal')
    return { success: true, message: 'Update posted successfully' }
  } catch (err: any) {
    console.error('submitVendorUpdate error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown') }
  }
}
