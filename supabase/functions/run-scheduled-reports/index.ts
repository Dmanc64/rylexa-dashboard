import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const REPORT_LABELS: Record<string, string> = {
  rent_roll: 'Rent Roll', profit_loss: 'Profit & Loss', vacancy: 'Vacancy Report',
  maintenance_cost: 'Maintenance Cost', ar_aging: 'AR Aging', owner_statement: 'Owner Statement',
}

function resolveDateFilters(filters: any): any {
  const r = { ...filters }; const t = new Date(); const yy = t.getFullYear(); const mm = t.getMonth(); const dd = t.getDate()
  switch (filters.dateRangeType) {
    case 'current_month': r.dateFrom = new Date(yy, mm, 1).toISOString().split('T')[0]; r.dateTo = new Date(yy, mm + 1, 0).toISOString().split('T')[0]; break
    case 'last_month': { const lm = new Date(yy, mm - 1, 1); r.dateFrom = lm.toISOString().split('T')[0]; r.dateTo = new Date(lm.getFullYear(), lm.getMonth() + 1, 0).toISOString().split('T')[0]; break }
    case 'last_30_days': r.dateTo = t.toISOString().split('T')[0]; r.dateFrom = new Date(yy, mm, dd - 30).toISOString().split('T')[0]; break
    case 'last_7_days': r.dateTo = t.toISOString().split('T')[0]; r.dateFrom = new Date(yy, mm, dd - 7).toISOString().split('T')[0]; break
  }
  return r
}

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Auth: only accept service role key
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.replace('Bearer ', '')
    if (token !== serviceKey) {
      return new Response(JSON.stringify({ error: 'Unauthorized: service role key required' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, serviceKey)

    // Check feature flag
    const { data: flag } = await supabase.from('feature_flags').select('value').eq('key', 'scheduled_reports').single()
    if (!flag?.value) {
      return new Response(JSON.stringify({ skipped: true, reason: 'feature_disabled' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Check for optional schedule_ids filter (for "Run Now" from UI)
    let body: any = {}
    try { body = await req.json() } catch { /* no body = process all due */ }
    const specificIds: string[] | null = body.schedule_ids || null

    // Get due schedules
    let schedules: any[]
    if (specificIds && specificIds.length > 0) {
      const { data, error } = await supabase.from('report_schedules').select('*').in('id', specificIds)
      if (error) throw error
      schedules = data || []
    } else {
      const { data, error } = await supabase.rpc('get_due_report_schedules')
      if (error) throw error
      schedules = data || []
    }

    if (schedules.length === 0) {
      return new Response(JSON.stringify({ processed: 0, message: 'No schedules due' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const results: any[] = []
    const startTime = Date.now()

    for (const schedule of schedules) {
      // Safety: stop if we've been running too long (50s guard)
      if (Date.now() - startTime > 50000) {
        results.push({ schedule_id: schedule.id, status: 'deferred', reason: 'timeout_guard' })
        continue
      }

      // Create run record
      const { data: run, error: runErr } = await supabase.from('report_schedule_runs').insert({
        schedule_id: schedule.id, status: 'running',
      }).select('id').single()

      if (runErr) {
        results.push({ schedule_id: schedule.id, status: 'failed', error: runErr.message })
        continue
      }

      try {
        // Resolve filters
        const resolvedFilters = resolveDateFilters(schedule.filters || {})

        // Call generate-report edge function with store=true
        const genRes = await fetch(`${supabaseUrl}/functions/v1/generate-report`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            report_type: schedule.report_type,
            filters: resolvedFilters,
            format: schedule.format || 'pdf',
            store: true,
          }),
        })

        if (!genRes.ok) {
          const errBody = await genRes.json().catch(() => ({ error: 'Unknown' }))
          throw new Error(`generate-report failed: ${errBody.error || genRes.status}`)
        }

        const genData = await genRes.json()
        const storagePath = genData.storage_path
        const exportId = genData.export_id
        const rowCount = genData.row_count || 0

        // Generate signed URL (1 hour expiry)
        let downloadUrl = ''
        if (storagePath) {
          const { data: signed } = await supabase.storage.from('documents').createSignedUrl(storagePath, 3600)
          downloadUrl = signed?.signedUrl || ''
        }

        // Queue email to each recipient
        const recipients = schedule.recipients || []
        const reportName = REPORT_LABELS[schedule.report_type] || schedule.report_type
        const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
        const filterSummary = resolvedFilters.dateFrom && resolvedFilters.dateTo
          ? `Period: ${resolvedFilters.dateFrom} to ${resolvedFilters.dateTo}`
          : 'All time'

        for (const recipient of recipients) {
          const emailBody = [
            `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">`,
            `<div style="background: #1e293b; color: white; padding: 24px; border-radius: 12px 12px 0 0;">`,
            `<h2 style="margin:0;font-size:18px;">Scheduled Report Ready</h2>`,
            `<p style="margin:4px 0 0;opacity:0.8;font-size:13px;">Rylexa Properties</p></div>`,
            `<div style="background: white; border: 1px solid #e2e8f0; padding: 24px; border-radius: 0 0 12px 12px;">`,
            `<p>Hi ${recipient.name || 'there'},</p>`,
            `<p>Your scheduled report <strong>"${schedule.name}"</strong> has been generated.</p>`,
            `<table style="width:100%;border-collapse:collapse;margin:16px 0;">`,
            `<tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;width:120px;">Report</td><td style="padding:6px 12px;">${reportName}</td></tr>`,
            `<tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Format</td><td style="padding:6px 12px;">${(schedule.format || 'pdf').toUpperCase()}</td></tr>`,
            `<tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Period</td><td style="padding:6px 12px;">${filterSummary}</td></tr>`,
            `<tr><td style="padding:6px 12px;background:#f8fafc;font-weight:600;">Records</td><td style="padding:6px 12px;">${rowCount}</td></tr>`,
            `</table>`,
            downloadUrl ? `<a href="${downloadUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:8px;font-weight:600;">Download Report</a>` : '',
            downloadUrl ? `<p style="color:#94a3b8;font-size:12px;margin-top:12px;">This link expires in 1 hour.</p>` : '',
            `</div></div>`,
          ].join('\n')

          await supabase.from('notification_queue').insert({
            recipient_email: recipient.email,
            recipient_name: recipient.name || null,
            subject: `Scheduled Report: ${reportName} - ${dateStr}`,
            body: emailBody,
            channel: 'email',
            status: 'pending',
            related_entity_id: schedule.id,
          })
        }

        // Update run record: completed
        await supabase.from('report_schedule_runs').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          report_export_id: exportId,
          storage_path: storagePath,
          recipients_sent: recipients,
          row_count: rowCount,
        }).eq('id', run.id)

        // Advance schedule: compute next_run_at
        const { data: nextRun } = await supabase.rpc('compute_next_run_at', {
          p_frequency: schedule.frequency,
          p_day_of_week: schedule.day_of_week,
          p_day_of_month: schedule.day_of_month,
          p_time_of_day: schedule.time_of_day,
          p_timezone: schedule.timezone || 'America/Los_Angeles',
          p_from_time: new Date().toISOString(),
        })

        await supabase.from('report_schedules').update({
          last_run_at: new Date().toISOString(),
          next_run_at: nextRun,
        }).eq('id', schedule.id)

        results.push({ schedule_id: schedule.id, status: 'completed', row_count: rowCount, recipients: recipients.length })

      } catch (err) {
        // Mark run as failed
        await supabase.from('report_schedule_runs').update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_details: (err as Error).message,
        }).eq('id', run.id)

        // Still advance next_run_at to prevent retry loops
        try {
          const { data: nextRun } = await supabase.rpc('compute_next_run_at', {
            p_frequency: schedule.frequency,
            p_day_of_week: schedule.day_of_week,
            p_day_of_month: schedule.day_of_month,
            p_time_of_day: schedule.time_of_day,
            p_timezone: schedule.timezone || 'America/Los_Angeles',
            p_from_time: new Date().toISOString(),
          })
          await supabase.from('report_schedules').update({
            last_run_at: new Date().toISOString(),
            next_run_at: nextRun,
          }).eq('id', schedule.id)
        } catch { /* best effort */ }

        results.push({ schedule_id: schedule.id, status: 'failed', error: (err as Error).message })
      }
    }

    const succeeded = results.filter(r => r.status === 'completed').length
    const failed = results.filter(r => r.status === 'failed').length

    return new Response(JSON.stringify({
      processed: schedules.length,
      succeeded,
      failed,
      deferred: results.filter(r => r.status === 'deferred').length,
      details: results,
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
