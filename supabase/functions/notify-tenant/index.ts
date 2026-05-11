import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts"

serve(async (req) => {
  // This function is triggered by a Supabase database webhook.
  // Webhooks send the service_role key as Authorization header automatically.
  if (req.method === 'OPTIONS') return handleCorsPreFlight(req)

  const corsHeaders = getCorsHeaders(req)

  try {
    // Verify the request carries a valid authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Data coming from the Supabase Webhook trigger
    const { record } = await req.json()

    // 1. Fetch Tenant Contact Info based on the activity event
    const { data: tenant } = await supabase
      .from('tenants')
      .select('email, phone, first_name, user_id')
      .eq('id', record.tenant_id)
      .single()

    if (!tenant) {
      return new Response(JSON.stringify({ error: "No tenant linked to event." }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Queue EMAIL notification
    const { error: queueError } = await supabase.from('notification_queue').insert({
      recipient_email: tenant.email,
      recipient_name: tenant.first_name,
      subject: `Rylexa Alert: ${record.title || record.event_type}`,
      body: record.description || 'You have a new notification from Rylexa.',
      channel: 'email',
    })

    if (queueError) throw queueError

    // 3. Queue SMS notification (if tenant has phone + SMS preference enabled)
    let smsQueued = false
    if (tenant.phone && tenant.user_id) {
      // Check if SMS feature flag is enabled
      const { data: flag } = await supabase
        .from('feature_flags')
        .select('value')
        .eq('key', 'sms_notifications')
        .single()

      if (flag?.value) {
        // Check tenant's SMS preference for this category
        // Map event_type to notification category
        const categoryMap: Record<string, string> = {
          'MAINTENANCE_UPDATE': 'maintenance',
          'WORK_ORDER_UPDATE': 'maintenance',
          'RENT_DUE': 'rent_reminder',
          'LATE_FEE': 'rent_reminder',
          'LEASE_EXPIRY': 'lease',
          'PAYMENT_RECEIVED': 'payment',
          'ANNOUNCEMENT': 'announcement',
        }
        const category = categoryMap[record.event_type] || 'announcement'

        // Check if user has explicitly opted OUT (default = opted in)
        const { data: pref } = await supabase
          .from('notification_preferences')
          .select('enabled')
          .eq('user_id', tenant.user_id)
          .eq('channel', 'sms')
          .eq('category', category)
          .single()

        // If no preference row exists, default to enabled. Only skip if explicitly disabled.
        const smsEnabled = pref === null || pref?.enabled !== false

        if (smsEnabled) {
          // Look up SMS template for this event type
          const templateSlug = record.event_type === 'MAINTENANCE_UPDATE' || record.event_type === 'WORK_ORDER_UPDATE'
            ? 'maintenance_update'
            : record.event_type === 'LATE_FEE' ? 'late_fee_notice'
            : record.event_type === 'PAYMENT_RECEIVED' ? 'payment_confirmation'
            : record.event_type === 'LEASE_EXPIRY' ? 'lease_expiry'
            : null

          let smsBody = record.description || 'You have a new notification from Rylexa.'

          if (templateSlug) {
            const { data: template } = await supabase
              .from('sms_templates')
              .select('body')
              .eq('slug', templateSlug)
              .eq('is_active', true)
              .single()

            if (template) {
              smsBody = template.body
                .replace(/\{\{tenant_name\}\}/g, tenant.first_name || 'Tenant')
                .replace(/\{\{ticket_title\}\}/g, record.title || '')
                .replace(/\{\{status_update\}\}/g, record.description || '')
            }
          }

          await supabase.from('notification_queue').insert({
            recipient_phone: tenant.phone,
            recipient_name: tenant.first_name,
            subject: `Rylexa: ${record.title || record.event_type}`,
            body: smsBody,
            channel: 'sms',
          })
          smsQueued = true
        }
      }
    }

    return new Response(JSON.stringify({
      queued: true,
      recipient: tenant.email,
      sms_queued: smsQueued,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
