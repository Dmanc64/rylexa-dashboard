'use server'

import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'

// ── Auth helper (same pattern as vendor-actions.ts) ──
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

// ── Find vendor record by email ──
async function findVendorByEmail(supabase: ReturnType<typeof getAdminClient>, email: string) {
  const { data } = await supabase
    .from('vendors')
    .select('id, company_name, contact_name, trade_type, hourly_rate')
    .ilike('email', email)
    .single()
  return data
}

/**
 * Vendor submits a bid on an open work order.
 */
export async function submitBid(formData: FormData) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return { success: false, message: 'Unauthorized: You must be logged in.' }

    const supabaseAdmin = getAdminClient()

    const vendor = await findVendorByEmail(supabaseAdmin, user.email ?? '')
    if (!vendor) return { success: false, message: 'No vendor record found for your email.' }

    const workOrderId = formData.get('workOrderId') as string
    const bidAmount = parseFloat(formData.get('bidAmount') as string)
    const estimatedHours = formData.get('estimatedHours') as string
    const proposedStart = formData.get('proposedStart') as string
    const notes = formData.get('notes') as string

    if (!workOrderId) return { success: false, message: 'Missing work order ID.' }
    if (isNaN(bidAmount) || bidAmount < 0) return { success: false, message: 'Invalid bid amount.' }

    // Verify work order is Open and bidding is enabled
    const { data: workOrder } = await supabaseAdmin
      .from('work_orders')
      .select('id, title, status, bidding_open, category')
      .eq('id', workOrderId)
      .single()

    if (!workOrder) return { success: false, message: 'Work order not found.' }
    if (workOrder.status !== 'Open') return { success: false, message: 'This work order is no longer open.' }
    if (!workOrder.bidding_open) return { success: false, message: 'Bidding is not open for this work order.' }

    // Check for existing bid
    const { data: existingBid } = await supabaseAdmin
      .from('vendor_bids')
      .select('id, status')
      .eq('work_order_id', workOrderId)
      .eq('vendor_id', vendor.id)
      .single()

    if (existingBid && existingBid.status !== 'Withdrawn') {
      return { success: false, message: 'You have already submitted a bid for this work order.' }
    }

    // Insert bid (or upsert if withdrawn)
    if (existingBid && existingBid.status === 'Withdrawn') {
      await supabaseAdmin
        .from('vendor_bids')
        .update({
          bid_amount: bidAmount,
          estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
          proposed_start: proposedStart || null,
          notes: notes || null,
          status: 'Pending',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingBid.id)
    } else {
      await supabaseAdmin.from('vendor_bids').insert({
        work_order_id: workOrderId,
        vendor_id: vendor.id,
        bid_amount: bidAmount,
        estimated_hours: estimatedHours ? parseFloat(estimatedHours) : null,
        proposed_start: proposedStart || null,
        notes: notes || null,
      })
    }

    // Log to system_activity
    const vendorName = vendor.company_name || vendor.contact_name || 'Vendor'
    await supabaseAdmin.from('system_activity').insert({
      event_type: 'VENDOR_BID_SUBMITTED',
      title: 'Vendor Submitted Bid',
      description: `${vendorName} bid $${bidAmount.toFixed(2)} on: ${workOrder.title}`,
      actor_name: vendorName,
      related_entity_id: workOrderId,
    })

    revalidatePath('/vendor-portal')
    return { success: true, message: 'Bid submitted successfully' }
  } catch (err: any) {
    console.error('submitBid error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown') }
  }
}

/**
 * Vendor withdraws their own pending bid.
 */
export async function withdrawBid(bidId: string) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return { success: false, message: 'Unauthorized' }

    const supabaseAdmin = getAdminClient()

    const vendor = await findVendorByEmail(supabaseAdmin, user.email ?? '')
    if (!vendor) return { success: false, message: 'No vendor record found.' }

    const { data: bid } = await supabaseAdmin
      .from('vendor_bids')
      .select('id, vendor_id, status')
      .eq('id', bidId)
      .single()

    if (!bid) return { success: false, message: 'Bid not found.' }
    if (bid.vendor_id !== vendor.id) return { success: false, message: 'This bid is not yours.' }
    if (bid.status !== 'Pending') return { success: false, message: 'Only pending bids can be withdrawn.' }

    const { error: withdrawError } = await supabaseAdmin
      .from('vendor_bids')
      .update({ status: 'Withdrawn', updated_at: new Date().toISOString() })
      .eq('id', bidId)

    if (withdrawError) return { success: false, message: 'Failed to withdraw bid: ' + withdrawError.message }

    revalidatePath('/vendor-portal')
    return { success: true, message: 'Bid withdrawn' }
  } catch (err: any) {
    console.error('withdrawBid error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown') }
  }
}

/**
 * Admin accepts a bid — assigns vendor, rejects all other bids.
 */
export async function acceptBid(bidId: string) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return { success: false, message: 'Unauthorized' }

    const supabaseAdmin = getAdminClient()

    // Verify admin/management role
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['Admin', 'Property Manager'].includes(profile.role)) {
      return { success: false, message: 'Only management can accept bids.' }
    }

    // Fetch the bid with vendor and work order info
    const { data: bid } = await supabaseAdmin
      .from('vendor_bids')
      .select('id, work_order_id, vendor_id, bid_amount, estimated_hours, status, vendors ( company_name, contact_name )')
      .eq('id', bidId)
      .single()

    if (!bid) return { success: false, message: 'Bid not found.' }
    if (bid.status !== 'Pending') return { success: false, message: 'This bid is no longer pending.' }

    const vendorInfo = bid.vendors as any
    const vendorName = vendorInfo?.company_name || vendorInfo?.contact_name || 'Vendor'

    // Accept this bid
    const { error: acceptError } = await supabaseAdmin
      .from('vendor_bids')
      .update({ status: 'Accepted', updated_at: new Date().toISOString() })
      .eq('id', bidId)

    if (acceptError) return { success: false, message: 'Failed to accept bid: ' + acceptError.message }

    // Reject all other pending bids on this work order
    await supabaseAdmin
      .from('vendor_bids')
      .update({ status: 'Rejected', updated_at: new Date().toISOString() })
      .eq('work_order_id', bid.work_order_id)
      .eq('status', 'Pending')
      .neq('id', bidId)

    // Assign vendor to work order + update cost estimate
    const updateData: Record<string, any> = {
      vendor_id: bid.vendor_id,
      status: 'Assigned',
      bidding_open: false,
    }
    if (bid.bid_amount) {
      updateData.cost = bid.bid_amount
      updateData.invoice_amount = bid.bid_amount
    }

    const { error: woError } = await supabaseAdmin
      .from('work_orders')
      .update(updateData)
      .eq('id', bid.work_order_id)

    if (woError) return { success: false, message: 'Failed to assign vendor: ' + woError.message }

    // Log to system_activity
    await supabaseAdmin.from('system_activity').insert({
      event_type: 'VENDOR_BID_ACCEPTED',
      title: 'Bid Accepted',
      description: `${vendorName}'s bid of $${bid.bid_amount} was accepted`,
      actor_name: profile.role,
      related_entity_id: bid.work_order_id,
    })

    revalidatePath('/admin/maintenance')
    revalidatePath('/vendor-portal')
    return { success: true, message: `Bid accepted — ${vendorName} assigned to work order` }
  } catch (err: any) {
    console.error('acceptBid error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown') }
  }
}

/**
 * Admin rejects a single bid.
 */
export async function rejectBid(bidId: string) {
  try {
    const user = await getAuthenticatedUser()
    if (!user) return { success: false, message: 'Unauthorized' }

    const supabaseAdmin = getAdminClient()

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (!profile || !['Admin', 'Property Manager'].includes(profile.role)) {
      return { success: false, message: 'Only management can reject bids.' }
    }

    const { data: bid } = await supabaseAdmin
      .from('vendor_bids')
      .select('id, status')
      .eq('id', bidId)
      .single()

    if (!bid) return { success: false, message: 'Bid not found.' }
    if (bid.status !== 'Pending') return { success: false, message: 'This bid is no longer pending.' }

    await supabaseAdmin
      .from('vendor_bids')
      .update({ status: 'Rejected', updated_at: new Date().toISOString() })
      .eq('id', bidId)

    revalidatePath('/admin/maintenance')
    return { success: true, message: 'Bid rejected' }
  } catch (err: any) {
    console.error('rejectBid error:', err)
    return { success: false, message: 'Unexpected error: ' + (err.message || 'Unknown') }
  }
}
