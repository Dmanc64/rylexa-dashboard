import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";

/**
 * apply-late-fees — Automated late fee application.
 *
 * Designed for cron/scheduler invocation (no browser CORS needed in practice,
 * but we include CORS headers for consistency and manual admin invocations).
 *
 * Uses configurable billing_settings (grace period, fee type/amount) instead
 * of hardcoded values. Idempotency is enforced by checking the accounting
 * table for existing Late Fee entries per lease per month.
 */
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  // Require Authorization header (cron sends service role key)
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    // 1. Load global billing settings
    const { data: settings } = await supabase
      .rpc('get_billing_settings', { p_property_id: null });

    const gracePeriod = settings?.[0]?.grace_period_days ?? 5;
    const autoLateFees = settings?.[0]?.auto_late_fees ?? true;

    // Check if auto late fees are enabled
    if (!autoLateFees) {
      return new Response(
        JSON.stringify({ message: 'Auto late fees are disabled in billing settings.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only run if we are past the grace period
    const today = new Date();
    if (today.getDate() <= gracePeriod) {
      return new Response(
        JSON.stringify({ message: `Within grace period (${gracePeriod} days). No fees applied.` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Find all tenants with an outstanding balance
    const { data: delinquents } = await supabase.rpc('get_delinquent_tenants');

    if (!delinquents || delinquents.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No delinquent accounts found.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
    let applied = 0;
    let skipped = 0;

    for (const tenant of delinquents) {
      // 3. Idempotency: check accounting table for existing Late Fee this month
      const { data: existing } = await supabase
        .from('accounting')
        .select('id')
        .eq('lease_id', tenant.lease_id)
        .eq('type', 'Late Fee')
        .gte('created_at', monthStart)
        .limit(1);

      if (existing && existing.length > 0) {
        skipped++;
        continue;
      }

      // 4. Look up property_id for per-property fee settings
      let propertyId: string | null = null;
      const { data: leaseData } = await supabase
        .from('leases')
        .select('unit_id, units(property_id)')
        .eq('id', tenant.lease_id)
        .single();

      if (leaseData?.units) {
        propertyId = (leaseData.units as any).property_id ?? null;
      }

      // 5. Calculate the fee amount using configurable settings
      const { data: feeAmount } = await supabase
        .rpc('calculate_late_fee_amount', {
          p_balance: tenant.balance_due,
          p_property_id: propertyId,
        });

      const fee = feeAmount ?? 50;
      if (fee <= 0) {
        skipped++;
        continue;
      }

      // 6. Post the late fee via double-entry RPC
      const monthName = today.toLocaleString('default', { month: 'long' });
      await supabase.rpc('post_late_fee', {
        t_id: tenant.id,
        amount: fee,
        desc: `Late Fee Applied - ${monthName} ${today.getFullYear()}`,
      });

      // 7. Log to system_activity
      await supabase.from('system_activity').insert({
        event_type: 'LEDGER_UPDATE',
        title: 'Late Fee Automated',
        description: `Applied $${fee} fee to ${tenant.last_name} (balance: $${tenant.balance_due})`,
        actor_name: 'Financial Engine',
      });

      // 8. Queue SMS notification for late fee (if enabled)
      try {
        const { data: smsFlag } = await supabase
          .from('feature_flags')
          .select('value')
          .eq('key', 'sms_notifications')
          .single();

        if (smsFlag?.value && tenant.phone) {
          // Check SMS preference (default = enabled if no preference row)
          const { data: smsPref } = tenant.user_id
            ? await supabase
                .from('notification_preferences')
                .select('enabled')
                .eq('user_id', tenant.user_id)
                .eq('channel', 'sms')
                .eq('category', 'rent_reminder')
                .single()
            : { data: null };

          if (smsPref === null || smsPref?.enabled !== false) {
            // Fetch SMS template
            const { data: template } = await supabase
              .from('sms_templates')
              .select('body')
              .eq('slug', 'late_fee_notice')
              .eq('is_active', true)
              .single();

            let propertyName = 'your property';
            if (propertyId) {
              const { data: prop } = await supabase
                .from('properties')
                .select('name')
                .eq('id', propertyId)
                .single();
              if (prop) propertyName = prop.name;
            }

            const smsBody = template
              ? template.body
                  .replace(/\{\{tenant_name\}\}/g, tenant.first_name || tenant.last_name || 'Tenant')
                  .replace(/\{\{fee_amount\}\}/g, fee.toString())
                  .replace(/\{\{balance\}\}/g, tenant.balance_due?.toString() || '0')
                  .replace(/\{\{property\}\}/g, propertyName)
              : `Hi ${tenant.first_name || 'Tenant'}, a late fee of $${fee} has been applied. Please pay promptly.`;

            await supabase.from('notification_queue').insert({
              recipient_phone: tenant.phone,
              recipient_name: tenant.first_name || tenant.last_name,
              subject: 'Late Fee Notice',
              body: smsBody,
              channel: 'sms',
            });
          }
        }
      } catch (smsErr) {
        console.error(`SMS queueing failed for tenant ${tenant.id}:`, (smsErr as Error).message);
      }

      applied++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        processed: applied,
        skipped: skipped,
        total_delinquent: delinquents.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
