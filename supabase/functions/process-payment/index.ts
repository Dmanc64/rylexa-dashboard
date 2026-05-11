import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
  apiVersion: "2024-04-10",
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);
  const corsHeaders = getCorsHeaders(req);

  try {
    // 1. Auth — any authenticated user (tenant pays their own rent)
    const { user } = await verifyAuth(req);

    // 2. Parse input
    const { lease_id, amount, payment_method_id } = (await req.json()) as {
      lease_id: string;
      amount: number;
      payment_method_id: string;
    };

    if (!lease_id || !amount || !payment_method_id) {
      return new Response(
        JSON.stringify({ error: "Missing lease_id, amount, or payment_method_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (amount <= 0) {
      return new Response(
        JSON.stringify({ error: "Amount must be greater than zero" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Service-role client for DB
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // 4. Verify tenant owns the lease
    const { data: lease, error: leaseErr } = await supabase
      .from("leases")
      .select("id, tenant_id, user_id, rent_amount")
      .eq("id", lease_id)
      .single();

    if (leaseErr || !lease) {
      return new Response(
        JSON.stringify({ error: "Lease not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authorization: check user_id link first, fall back to tenant email matching
    if (lease.user_id) {
      if (lease.user_id !== user.id) {
        return new Response(
          JSON.stringify({ error: "You are not authorized to make payments on this lease" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // No user_id on lease — verify via tenant email match
      const { data: tenant } = await supabase
        .from("tenants")
        .select("email")
        .eq("id", lease.tenant_id)
        .single();

      if (!tenant || tenant.email?.toLowerCase() !== user.email?.toLowerCase()) {
        return new Response(
          JSON.stringify({ error: "You are not authorized to make payments on this lease" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Auto-link user_id on the lease for future direct lookups
      await supabase
        .from("leases")
        .update({ user_id: user.id })
        .eq("id", lease_id);
    }

    // 5. Get or create Stripe Customer
    let stripeCustomerId: string;

    const { data: existingPM } = await supabase
      .from("tenant_payment_methods")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (existingPM?.stripe_customer_id) {
      stripeCustomerId = existingPM.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create({
        metadata: { user_id: user.id, tenant_id: lease.tenant_id },
      });
      stripeCustomerId = customer.id;
    }

    // 6. Attach payment method to customer (idempotent)
    try {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: stripeCustomerId,
      });
    } catch (attachErr: any) {
      // Already attached is fine
      if (!attachErr.message?.includes("already been attached")) {
        throw attachErr;
      }
    }

    // 7. Create and confirm PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // cents
      currency: "usd",
      customer: stripeCustomerId,
      payment_method: payment_method_id,
      confirm: true,
      off_session: false,
      description: `Rent payment for lease ${lease_id}`,
      metadata: {
        lease_id,
        tenant_id: lease.tenant_id,
        user_id: user.id,
      },
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
    });

    if (paymentIntent.status !== "succeeded") {
      return new Response(
        JSON.stringify({
          error: `Payment not completed. Status: ${paymentIntent.status}`,
          requires_action: paymentIntent.status === "requires_action",
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. Get card details from the payment method
    const pm = await stripe.paymentMethods.retrieve(payment_method_id);
    const cardBrand = pm.card?.brand || "unknown";
    const cardLast4 = pm.card?.last4 || "****";

    // 9. Record payment in DB (accounting + GL)
    const { data: recordResult, error: recordErr } = await supabase.rpc(
      "record_payment",
      {
        p_lease_id: lease_id,
        p_amount: amount,
        p_stripe_pi_id: paymentIntent.id,
        p_stripe_pm_id: payment_method_id,
        p_card_brand: cardBrand,
        p_card_last4: cardLast4,
        p_is_autopay: false,
      }
    );

    if (recordErr) {
      console.error("record_payment error:", recordErr);
      // Payment succeeded in Stripe but DB recording failed
      // Return error so the frontend knows balance won't reflect yet
      return new Response(
        JSON.stringify({
          error: "Payment was charged but failed to record in the system. Please contact support.",
          stripe_payment_intent_id: paymentIntent.id,
          amount,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 10. Log to system_activity
    await supabase.from("system_activity").insert({
      event_type: "payment_received",
      description: `Payment of $${amount.toFixed(2)} received via card ending ${cardLast4}`,
      metadata: {
        lease_id,
        payment_intent_id: paymentIntent.id,
        amount,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        card_brand: cardBrand,
        card_last4: cardLast4,
        amount,
        payment_id: recordResult?.payment_id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("process-payment error:", err.message);
    const status = err.message?.includes("Authorization") ? 401 : 400;
    return new Response(
      JSON.stringify({ error: err.message || "Payment processing failed" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
