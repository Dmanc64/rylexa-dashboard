import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { requireRole } from "../_shared/auth.ts";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-04-10",
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);
  const corsHeaders = getCorsHeaders(req);

  try {
    // Admin/PM only (or triggered via cron)
    await requireRole(req, ["Admin", "Property Manager"]);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 1. Find active autopay settings due today or earlier
    const today = new Date().toISOString().split("T")[0];

    const { data: dueSettings, error: fetchErr } = await supabase
      .from("autopay_settings")
      .select(`
        id, lease_id, payment_method_id, amount_type, fixed_amount, max_amount,
        tenant_payment_methods!inner(
          stripe_customer_id, stripe_payment_method_id
        )
      `)
      .eq("is_active", true)
      .lte("next_run_date", today);

    if (fetchErr) throw new Error("Failed to fetch autopay settings: " + fetchErr.message);

    if (!dueSettings || dueSettings.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "No autopay due" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: { lease_id: string; status: string; amount?: number; error?: string }[] = [];

    for (const setting of dueSettings) {
      try {
        // 2. Calculate charge amount
        let chargeAmount: number;

        if (setting.amount_type === "fixed" && setting.fixed_amount) {
          chargeAmount = Number(setting.fixed_amount);
        } else {
          // Get outstanding balance from accounting
          const { data: balanceData } = await supabase.rpc("get_tenant_balance", {
            p_lease_id: setting.lease_id,
          });

          // Fallback: calculate from accounting table directly
          if (balanceData != null) {
            chargeAmount = Math.max(0, Number(balanceData));
          } else {
            // Sum charges minus payments for the lease
            const { data: charges } = await supabase
              .from("accounting")
              .select("type, amount")
              .eq("lease_id", setting.lease_id);

            if (!charges) {
              results.push({ lease_id: setting.lease_id, status: "skipped", error: "Could not determine balance" });
              continue;
            }

            const total = charges.reduce((sum, c) => {
              if (c.type === "Payment" || c.type === "Credit") return sum - Number(c.amount);
              return sum + Number(c.amount);
            }, 0);

            chargeAmount = Math.max(0, total);
          }
        }

        // Apply max_amount cap
        if (setting.max_amount && chargeAmount > Number(setting.max_amount)) {
          chargeAmount = Number(setting.max_amount);
        }

        // Skip if nothing to charge
        if (chargeAmount <= 0) {
          results.push({ lease_id: setting.lease_id, status: "skipped", error: "No balance due" });
          continue;
        }

        const pmData = setting.tenant_payment_methods as any;

        // 3. Create PaymentIntent (off_session for recurring)
        const paymentIntent = await stripe.paymentIntents.create({
          amount: Math.round(chargeAmount * 100),
          currency: "usd",
          customer: pmData.stripe_customer_id,
          payment_method: pmData.stripe_payment_method_id,
          confirm: true,
          off_session: true,
          description: `Autopay rent for lease ${setting.lease_id}`,
          metadata: { lease_id: setting.lease_id, autopay_setting_id: setting.id },
          automatic_payment_methods: {
            enabled: true,
            allow_redirects: "never",
          },
        });

        if (paymentIntent.status === "succeeded") {
          // 4. Record in DB
          const pm = await stripe.paymentMethods.retrieve(pmData.stripe_payment_method_id);

          await supabase.rpc("record_payment", {
            p_lease_id: setting.lease_id,
            p_amount: chargeAmount,
            p_stripe_pi_id: paymentIntent.id,
            p_stripe_pm_id: pmData.stripe_payment_method_id,
            p_card_brand: pm.card?.brand || "unknown",
            p_card_last4: pm.card?.last4 || "****",
            p_is_autopay: true,
          });

          // 5. Update next_run_date
          const nextDate = new Date(setting.next_run_date || today);
          nextDate.setMonth(nextDate.getMonth() + 1);

          await supabase
            .from("autopay_settings")
            .update({ next_run_date: nextDate.toISOString().split("T")[0] })
            .eq("id", setting.id);

          results.push({ lease_id: setting.lease_id, status: "succeeded", amount: chargeAmount });
        } else {
          results.push({ lease_id: setting.lease_id, status: "failed", error: `PI status: ${paymentIntent.status}` });
        }
      } catch (itemErr: any) {
        console.error(`Autopay failed for lease ${setting.lease_id}:`, itemErr.message);
        results.push({ lease_id: setting.lease_id, status: "failed", error: itemErr.message });
      }
    }

    // 6. Log summary
    const succeeded = results.filter((r) => r.status === "succeeded").length;
    const failed = results.filter((r) => r.status === "failed").length;

    await supabase.from("system_activity").insert({
      event_type: "autopay_batch",
      description: `Autopay batch: ${succeeded} succeeded, ${failed} failed out of ${results.length} due`,
      metadata: { results },
    });

    return new Response(
      JSON.stringify({ success: true, processed: results.length, succeeded, failed, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("process-autopay error:", err.message);
    const status = err.message?.includes("Authorization") ? 401 : 400;
    return new Response(
      JSON.stringify({ error: err.message || "Autopay processing failed" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
