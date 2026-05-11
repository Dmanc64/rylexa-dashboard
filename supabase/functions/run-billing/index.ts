import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "./_shared/cors.ts";
import { requireRole } from "./_shared/auth.ts";

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);

  try {
    // 1. Auth: require Admin, Property Manager, or Accounting role
    const { user } = await requireRole(req, ['Admin', 'Property Manager', 'Accounting']);

    // 2. Parse request body
    const { operations, target_date } = await req.json() as {
      operations: string[];
      target_date: string;
    };

    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No billing operations specified.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const billingDate = target_date || new Date().toISOString().split('T')[0];

    // 3. Create service-role client for DB operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // 4. Determine run_type for the audit log
    const hasRent = operations.includes('rent');
    const hasUtilities = operations.includes('utilities');
    const hasLateFees = operations.includes('late_fees');
    let runType = 'full';
    if (hasRent && !hasUtilities && !hasLateFees) runType = 'rent';
    else if (!hasRent && hasUtilities && !hasLateFees) runType = 'utility';
    else if (!hasRent && !hasUtilities && hasLateFees) runType = 'late_fee';

    // 5. Create billing_runs audit row
    const { data: billingRun, error: runError } = await supabase
      .from('billing_runs')
      .insert({
        run_date: billingDate,
        run_type: runType,
        triggered_by: user.id,
        status: 'running',
      })
      .select('id')
      .single();

    if (runError) {
      return new Response(
        JSON.stringify({ error: 'Failed to create billing run: ' + runError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const runId = billingRun.id;
    let rentCount = 0;
    let utilityCount = 0;
    let lateFeeCount = 0;

    // --- RENT CHARGES ---
    if (hasRent) {
      const { data: rentResult, error: rentErr } = await supabase
        .rpc('post_monthly_rent', { target_date: billingDate });

      if (rentErr) {
        await supabase.from('billing_runs').update({
          status: 'failed',
          error_details: 'Rent posting failed: ' + rentErr.message,
          rent_charges_posted: 0,
        }).eq('id', runId);

        return new Response(
          JSON.stringify({ error: 'Rent posting failed: ' + rentErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      rentCount = rentResult ?? 0;

      // Queue SMS rent reminders for opted-in tenants
      try {
        const { data: smsFlag } = await supabase
          .from('feature_flags')
          .select('value')
          .eq('key', 'sms_notifications')
          .single();

        if (smsFlag?.value && rentCount > 0) {
          // Get active leases with tenant contact info
          const { data: activeLeases } = await supabase
            .from('leases')
            .select(`
              id, rent_amount,
              tenants(first_name, last_name, phone, user_id),
              units(name, properties(name))
            `)
            .eq('status', 'Active');

          if (activeLeases) {
            const { data: template } = await supabase
              .from('sms_templates')
              .select('body')
              .eq('slug', 'rent_reminder')
              .eq('is_active', true)
              .single();

            for (const lease of activeLeases) {
              const t = lease.tenants as any;
              if (!t?.phone || !t?.user_id) continue;

              // Check SMS preference (skip only if explicitly disabled)
              const { data: pref } = await supabase
                .from('notification_preferences')
                .select('enabled')
                .eq('user_id', t.user_id)
                .eq('channel', 'sms')
                .eq('category', 'rent_reminder')
                .single();

              if (pref?.enabled === false) continue;

              const propertyName = (lease.units as any)?.properties?.name || 'your property';

              const smsBody = template
                ? template.body
                    .replace(/\{\{tenant_name\}\}/g, t.first_name || 'Tenant')
                    .replace(/\{\{amount\}\}/g, lease.rent_amount?.toString() || '0')
                    .replace(/\{\{property\}\}/g, propertyName)
                    .replace(/\{\{due_date\}\}/g, 'the 1st')
                : `Hi ${t.first_name || 'Tenant'}, your rent of $${lease.rent_amount} is due. Please pay promptly.`;

              await supabase.from('notification_queue').insert({
                recipient_phone: t.phone,
                recipient_name: t.first_name || t.last_name,
                subject: 'Rent Reminder',
                body: smsBody,
                channel: 'sms',
              });
            }
          }
        }
      } catch (_smsErr) {
        // SMS queueing should not block billing
      }
    }

    // --- UTILITY CHARGES ---
    if (hasUtilities) {
      const { data: utilResult, error: utilErr } = await supabase
        .rpc('post_monthly_utilities', { target_date: billingDate });

      if (utilErr) {
        await supabase.from('billing_runs').update({
          status: 'failed',
          error_details: 'Utility posting failed: ' + utilErr.message,
          rent_charges_posted: rentCount,
        }).eq('id', runId);

        return new Response(
          JSON.stringify({ error: 'Utility posting failed: ' + utilErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      utilityCount = utilResult ?? 0;
    }

    // --- LATE FEES ---
    if (hasLateFees) {
      // Get delinquent tenants
      const { data: delinquents, error: delErr } = await supabase
        .rpc('get_delinquent_tenants');

      if (delErr) {
        await supabase.from('billing_runs').update({
          status: 'failed',
          error_details: 'Delinquent lookup failed: ' + delErr.message,
          rent_charges_posted: rentCount,
          utility_charges_posted: utilityCount,
        }).eq('id', runId);

        return new Response(
          JSON.stringify({ error: 'Delinquent lookup failed: ' + delErr.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (delinquents && delinquents.length > 0) {
        const today = new Date(billingDate);
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

        for (const tenant of delinquents) {
          // Idempotency: check if a Late Fee was already posted this month for this lease
          const { data: existing } = await supabase
            .from('accounting')
            .select('id')
            .eq('lease_id', tenant.lease_id)
            .eq('type', 'Late Fee')
            .gte('created_at', monthStart)
            .limit(1);

          if (existing && existing.length > 0) continue;

          // Get property_id for per-property settings lookup
          let propertyId: string | null = null;
          const { data: leaseData } = await supabase
            .from('leases')
            .select('unit_id, units(property_id)')
            .eq('id', tenant.lease_id)
            .single();

          if (leaseData?.units) {
            propertyId = (leaseData.units as any).property_id ?? null;
          }

          // Get the configurable fee amount
          const { data: feeAmount } = await supabase
            .rpc('calculate_late_fee_amount', {
              p_balance: tenant.balance_due,
              p_property_id: propertyId,
            });

          const fee = feeAmount ?? 50;
          if (fee <= 0) continue;

          // Post the late fee via the existing RPC
          const monthName = today.toLocaleString('default', { month: 'long' });
          await supabase.rpc('post_late_fee', {
            t_id: tenant.id,
            amount: fee,
            desc: `Late Fee Applied - ${monthName} ${today.getFullYear()}`,
          });

          // Log to system_activity
          await supabase.from('system_activity').insert({
            event_type: 'LEDGER_UPDATE',
            title: 'Late Fee - Billing Engine',
            description: `Applied $${fee} late fee to ${tenant.last_name} (balance: $${tenant.balance_due})`,
            actor_name: 'Billing Engine',
          });

          lateFeeCount++;
        }
      }
    }

    // 6. Update billing run with final counts
    await supabase.from('billing_runs').update({
      status: 'completed',
      rent_charges_posted: rentCount,
      utility_charges_posted: utilityCount,
      late_fees_posted: lateFeeCount,
    }).eq('id', runId);

    // 7. Log to system_activity
    const parts: string[] = [];
    if (rentCount > 0) parts.push(`${rentCount} rent`);
    if (utilityCount > 0) parts.push(`${utilityCount} utility`);
    if (lateFeeCount > 0) parts.push(`${lateFeeCount} late fee`);

    if (parts.length > 0) {
      await supabase.from('system_activity').insert({
        event_type: 'BILLING_RUN',
        title: 'Billing Run Completed',
        description: `Posted ${parts.join(', ')} charge(s) for ${billingDate}`,
        actor_name: 'Billing Engine',
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        billing_run_id: runId,
        rent_charges: rentCount,
        utility_charges: utilityCount,
        late_fees: lateFeeCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const corsHeaders = getCorsHeaders(req);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: message.includes('Access denied') || message.includes('Authorization') ? 403 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
