'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { DOCUMENT_ALLOWED_TYPES, DOCUMENT_MAX_FILE_SIZE, sanitizeFileName } from '@/lib/upload-utils'

// ── Auth helper ──
async function getAuthenticatedUser() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) { return cookieStore.get(name)?.value },
        set() {},
        remove() {},
      },
    }
  )
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) return null
  return user
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )
}

/**
 * Vendor submits an invoice for a completed work order.
 */
export async function submitInvoice(formData: FormData) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return { success: false, message: 'Unauthorized: You must be logged in.' }

    const supabaseAdmin = getAdminClient()

    // Find vendor by email
    const { data: vendor } = await supabaseAdmin
      .from('vendors')
      .select('id, company_name, contact_name')
      .ilike('email', user.email ?? '')
      .single()

    if (!vendor) return { success: false, message: 'No vendor record found for your email.' }

    // Extract form data
    const workOrderId = formData.get('workOrderId') as string
    const amount = parseFloat(formData.get('amount') as string)
    const description = formData.get('description') as string
    const lineItemsRaw = formData.get('lineItems') as string
    const file = formData.get('file') as File | null

    if (!workOrderId) return { success: false, message: 'Missing work order ID.' }
    if (isNaN(amount) || amount <= 0) return { success: false, message: 'Invalid invoice amount.' }

    // Verify vendor owns this work order
    const { data: workOrder } = await supabaseAdmin
      .from('work_orders')
      .select('id, title, vendor_id, status, cost, labor_cost')
      .eq('id', workOrderId)
      .single()

    if (!workOrder) return { success: false, message: 'Work order not found.' }
    if (workOrder.vendor_id !== vendor.id) return { success: false, message: 'This work order is not assigned to you.' }

    // Invoice amount cap: cannot exceed estimated cost by more than 20%
    const estimatedCost = workOrder.cost || workOrder.labor_cost || 0
    if (estimatedCost > 0) {
      const maxAllowed = estimatedCost * 1.2
      if (amount > maxAllowed) {
        return {
          success: false,
          message: `Invoice amount ($${amount.toFixed(2)}) exceeds the estimated cost ($${estimatedCost.toFixed(2)}) by more than 20%. Maximum allowed: $${maxAllowed.toFixed(2)}. Contact management for approval.`,
        }
      }
    }

    // Check that work order is in a state where invoicing makes sense
    const invoiceableStatuses = ['In Progress', 'Completed', 'Done', 'Closed']
    if (!invoiceableStatuses.includes(workOrder.status)) {
      return { success: false, message: 'Invoices can only be submitted for in-progress or completed work orders.' }
    }

    // Check for existing submitted invoice
    const { data: existingInvoice } = await supabaseAdmin
      .from('vendor_invoices')
      .select('id, status')
      .eq('work_order_id', workOrderId)
      .eq('vendor_id', vendor.id)
      .in('status', ['Submitted', 'Under Review', 'Approved'])
      .limit(1)
      .single()

    if (existingInvoice) {
      return { success: false, message: 'An invoice has already been submitted for this work order.' }
    }

    // Upload file if provided
    let fileUrl: string | null = null
    let fileName: string | null = null

    if (file && file.size > 0) {
      if (!DOCUMENT_ALLOWED_TYPES.includes(file.type)) {
        return { success: false, message: `Invalid file type. Allowed: PDF, JPEG, PNG, WebP, Word, Excel, Text.` }
      }
      if (file.size > DOCUMENT_MAX_FILE_SIZE) {
        return { success: false, message: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum: 25MB.` }
      }

      const safeName = sanitizeFileName(file.name)
      const storagePath = `invoices/${workOrderId}/${Date.now()}-${safeName}`

      const { error: uploadError } = await supabaseAdmin.storage
        .from('maintenance-images')
        .upload(storagePath, file, { contentType: file.type })

      if (uploadError) return { success: false, message: 'File upload failed: ' + uploadError.message }

      const { data: { publicUrl } } = supabaseAdmin.storage
        .from('maintenance-images')
        .getPublicUrl(storagePath)

      fileUrl = publicUrl
      fileName = file.name
    }

    // Parse and validate line items
    let lineItems: any[] = []
    if (lineItemsRaw) {
      try {
        const parsed = JSON.parse(lineItemsRaw)
        if (!Array.isArray(parsed)) { lineItems = [] }
        else { lineItems = parsed.slice(0, 100) } // Limit to 100 line items
      } catch { lineItems = [] }
    }

    // Insert invoice
    const { error: insertError } = await supabaseAdmin.from('vendor_invoices').insert({
      work_order_id: workOrderId,
      vendor_id: vendor.id,
      amount,
      description: description || null,
      line_items: lineItems,
      file_url: fileUrl,
      file_name: fileName,
    })

    if (insertError) return { success: false, message: 'Failed to submit invoice: ' + insertError.message }

    // Log to system_activity
    const vendorName = vendor.company_name || vendor.contact_name || 'Vendor'
    await supabaseAdmin.from('system_activity').insert({
      event_type: 'VENDOR_INVOICE_SUBMITTED',
      title: 'Invoice Submitted',
      description: `${vendorName} submitted invoice for $${amount.toFixed(2)} on: ${workOrder.title}`,
      actor_name: vendorName,
      related_entity_id: workOrderId,
    })

    revalidatePath('/vendor-portal')
    revalidatePath('/admin/maintenance')
    return { success: true, message: 'Invoice submitted successfully' }
  } catch (err: any) {
    console.error('submitInvoice error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown') }
  }
}

/**
 * Admin approves or rejects a vendor invoice.
 */
export async function reviewInvoice(
  invoiceId: string,
  action: 'approve' | 'reject',
  adminNotes?: string
) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return { success: false, message: 'Unauthorized' }

    const supabaseAdmin = getAdminClient()

    // Verify management role
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['Admin', 'Property Manager'].includes(profile.role)) {
      return { success: false, message: 'Only management can review invoices.' }
    }

    // Fetch invoice
    const { data: invoice } = await supabaseAdmin
      .from('vendor_invoices')
      .select('id, work_order_id, vendor_id, amount, status, vendors ( company_name, contact_name )')
      .eq('id', invoiceId)
      .single()

    if (!invoice) return { success: false, message: 'Invoice not found.' }
    if (!['Submitted', 'Under Review'].includes(invoice.status)) {
      return { success: false, message: 'This invoice has already been reviewed.' }
    }

    const vendorInfo = invoice.vendors as any
    const vendorName = vendorInfo?.company_name || vendorInfo?.contact_name || 'Vendor'
    const newStatus = action === 'approve' ? 'Approved' : 'Rejected'

    // Update invoice status
    const now = new Date().toISOString()
    const { error: invoiceUpdateError } = await supabaseAdmin
      .from('vendor_invoices')
      .update({
        status: newStatus,
        admin_notes: adminNotes || null,
        reviewed_by: user.id,
        reviewed_at: now,
        updated_at: now,
      })
      .eq('id', invoiceId)

    if (invoiceUpdateError) {
      return { success: false, message: 'Failed to update invoice: ' + invoiceUpdateError.message }
    }

    // If approved, update work order invoice_amount and recalculate cost
    if (action === 'approve') {
      const { data: workOrder } = await supabaseAdmin
        .from('work_orders')
        .select('labor_cost, materials_cost')
        .eq('id', invoice.work_order_id)
        .single()

      const materialsTotal = workOrder?.materials_cost || 0
      const totalCost = invoice.amount + materialsTotal

      const { error: woUpdateError } = await supabaseAdmin
        .from('work_orders')
        .update({
          invoice_amount: invoice.amount,
          cost: totalCost,
          cost_pending_review: false,
        })
        .eq('id', invoice.work_order_id)

      if (woUpdateError) {
        console.error('Work order cost update failed:', woUpdateError)
      }
    }

    // Log to system_activity
    await supabaseAdmin.from('system_activity').insert({
      event_type: action === 'approve' ? 'INVOICE_APPROVED' : 'INVOICE_REJECTED',
      title: `Invoice ${newStatus}`,
      description: `${vendorName}'s invoice for $${invoice.amount} was ${newStatus.toLowerCase()}`,
      actor_name: profile.role,
      related_entity_id: invoice.work_order_id,
    })

    revalidatePath('/admin/maintenance')
    revalidatePath('/vendor-portal')
    return { success: true, message: `Invoice ${newStatus.toLowerCase()}` }
  } catch (err: any) {
    console.error('reviewInvoice error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown') }
  }
}
