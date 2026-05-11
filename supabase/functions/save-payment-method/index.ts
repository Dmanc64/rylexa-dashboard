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
    const { user } = await verifyAuth(req);

    // Accept both camelCase (frontend) and snake_case parameter names
    const body = await req.json();
    const payment_method_id = body.payment_method_id || body.paymentMethodId;

    if (!payment_method_id) {
      return new Response(
        JSON.stringify({ error: "Missing payment_method_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Find tenant record — try user_id link first, fall back to email matching
    let lease: { tenant_id: string } | null = null;

    const { data: linkedLease } = await supabase
      .from("leases")
      .select("tenant_id")
      .eq("user_id", user.id)
      .eq("status", "Active")
      .limit(1)
      .single();

    if (linkedLease) {
      lease = linkedLease;
    } else {
      // Fall back to email matching via tenants table
      const { data: tenant } = await supabase
        .from("tenants")
        .select("id")
        .eq("email", user.email?.toLowerCase())
        .limit(1)
        .single();

      if (tenant) {
        const { data: tenantLease } = await supabase
          .from("leases")
          .select("id, tenant_id")
          .eq("tenant_id", tenant.id)
          .eq("status", "Active")
          .limit(1)
          .single();

        if (tenantLease) {
          lease = { tenant_id: tenantLease.tenant_id };
          // Auto-link user_id on the lease for future direct lookups
          await supabase
            .from("leases")
            .update({ user_id: user.id })
            .eq("id", tenantLease.id);
        }
      }
    }

    if (!lease) {
      return new Response(
        JSON.stringify({ error: "No active lease found for your account" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get or create Stripe Customer
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

    // Attach payment method to customer
    try {
      await stripe.paymentMethods.attach(payment_method_id, {
        customer: stripeCustomerId,
      });
    } catch (attachErr: any) {
      if (!attachErr.message?.includes("already been attached")) {
        throw attachErr;
      }
    }

    // Get card details
    const pm = await stripe.paymentMethods.retrieve(payment_method_id);
    const cardBrand = pm.card?.brand || "unknown";
    const cardLast4 = pm.card?.last4 || "****";
    const expMonth = pm.card?.exp_month;
    const expYear = pm.card?.exp_year;

    // Check if this is the first saved card (make it default)
    const { count } = await supabase
      .from("tenant_payment_methods")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    const isFirst = (count ?? 0) === 0;

    // Save to DB
    const { data: saved, error: saveErr } = await supabase
      .from("tenant_payment_methods")
      .insert({
        tenant_id: lease.tenant_id,
        user_id: user.id,
        stripe_customer_id: stripeCustomerId,
        stripe_payment_method_id: payment_method_id,
        card_brand: cardBrand,
        card_last4: cardLast4,
        exp_month: expMonth,
        exp_year: expYear,
        is_default: isFirst,
      })
      .select()
      .single();

    if (saveErr) {
      throw new Error("Failed to save payment method: " + saveErr.message);
    }

    return new Response(
      JSON.stringify({
        success: true,
        payment_method: {
          id: saved.id,
          card_brand: cardBrand,
          card_last4: cardLast4,
          exp_month: expMonth,
          exp_year: expYear,
          is_default: isFirst,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("save-payment-method error:", err.message);
    const status = err.message?.includes("Authorization") ? 401 : 400;
    return new Response(
      JSON.stringify({ error: err.message || "Failed to save payment method" }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
