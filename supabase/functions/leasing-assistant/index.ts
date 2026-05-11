import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { requireRole } from "../_shared/auth.ts";

/**
 * leasing-assistant — generate an outbound draft response for a lead.
 *
 * POST { lead_id }
 *
 * Fetches the lead, their interested unit_listing (if any), and the property
 * it sits on. Hands context + rules to GPT-4o Mini and asks for a structured
 * draft with SMS + email content, qualifying questions, and suggested CTAs.
 * Persists the result into ai_drafts and returns the row.
 *
 * Reviewed and sent by a human from LeasingAiDraftModal; this function does
 * NOT send anything itself.
 */

type Lead = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  source: string;
  stage: string;
  desired_move_in: string | null;
  desired_bedrooms: number | null;
  budget_max: number | null;
  interested_unit_id: string | null;
  interested_property_id: string | null;
  source_listing_id: string | null;
  notes: string | null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);
  const corsHeaders = getCorsHeaders(req);

  try {
    const { user } = await requireRole(req, ["Admin", "Property Manager"]);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Feature flag guard.
    const { data: flag } = await supabase
      .from("feature_flags")
      .select("value")
      .eq("key", "leasing_ai_assistant")
      .single();
    if (!flag?.value) {
      return new Response(
        JSON.stringify({ error: "AI leasing assistant is disabled." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
      );
    }

    const { lead_id } = await req.json();
    if (!lead_id) throw new Error("lead_id is required");

    // Rate limit: 30 AI drafts per hour org-wide.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabase
      .from("ai_drafts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", oneHourAgo);
    if ((recentCount ?? 0) >= 30) {
      return new Response(
        JSON.stringify({ error: "Rate limit exceeded. Max 30 AI drafts per hour." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 429 },
      );
    }

    // Pull lead + related context.
    const { data: lead, error: leadErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", lead_id)
      .single();
    if (leadErr || !lead) throw new Error(`Lead not found: ${leadErr?.message ?? lead_id}`);
    const typedLead = lead as Lead;

    // Find a listing — prefer source_listing_id, fall back to interested_unit_id.
    let listing: Record<string, unknown> | null = null;
    if (typedLead.source_listing_id) {
      const { data } = await supabase
        .from("unit_listings")
        .select("*")
        .eq("id", typedLead.source_listing_id)
        .maybeSingle();
      listing = data as Record<string, unknown> | null;
    }
    if (!listing && typedLead.interested_unit_id) {
      const { data } = await supabase
        .from("unit_listings")
        .select("*")
        .eq("unit_id", typedLead.interested_unit_id)
        .maybeSingle();
      listing = data as Record<string, unknown> | null;
    }

    // Property name for personalization.
    let propertyName: string | null = null;
    if (typedLead.interested_property_id) {
      const { data: p } = await supabase
        .from("properties")
        .select("name")
        .eq("id", typedLead.interested_property_id)
        .maybeSingle();
      propertyName = (p as { name?: string } | null)?.name ?? null;
    }

    // Unit context (bedrooms not on base units table per migration 001;
    // bathrooms, amenities, pet_policy, availability_date were added later).
    let unit: Record<string, unknown> | null = null;
    if (typedLead.interested_unit_id) {
      const { data } = await supabase
        .from("units")
        .select(
          "id, name, market_rent, bathrooms, sqft, description, amenities, pet_policy, availability_date, status",
        )
        .eq("id", typedLead.interested_unit_id)
        .maybeSingle();
      unit = data as Record<string, unknown> | null;
    }

    const context = {
      lead: {
        first_name: typedLead.first_name,
        last_name: typedLead.last_name,
        email: typedLead.email,
        phone: typedLead.phone,
        source: typedLead.source,
        stage: typedLead.stage,
        desired_move_in: typedLead.desired_move_in,
        desired_bedrooms: typedLead.desired_bedrooms,
        budget_max: typedLead.budget_max,
        notes: typedLead.notes,
      },
      property: { name: propertyName },
      unit,
      listing,
    };

    const systemPrompt = [
      "You are a friendly, professional leasing assistant for a property management company.",
      "A prospective renter just inquired. Draft a concise, helpful, personalized outbound response.",
      "Rules:",
      "- Address the prospect by first name.",
      "- If a unit or listing is provided, confirm the property/unit and quote rent, bedrooms (if known), pet policy, and availability_date succinctly.",
      "- Never invent facts that aren't in the supplied context. If data is missing, omit it rather than guessing.",
      "- Ask 2–3 qualifying questions: desired move-in date, household size, pets, income/employment — only the ones not already answered in the lead record.",
      "- Propose scheduling a showing. Say the prospect can reply with preferred times (we do not have an automated calendar yet).",
      "- Invite them to apply via the online application if they're ready.",
      "- Tone: warm but crisp. Short paragraphs. No emoji. No pushy sales language.",
      "",
      "Return ONLY a JSON object with this exact shape:",
      "{",
      '  "subject": string,              // email subject line, under 70 chars',
      '  "body_text": string,            // plain-text email body, 80–220 words',
      '  "body_html": string,            // HTML version of body_text (use <p>, <ul>, <li>, <strong>)',
      '  "sms_text": string,             // single SMS, 240–480 chars, no URLs other than the application link if provided',
      '  "suggested_questions": string[],',
      '  "suggested_actions": { "label": string, "url": string }[]',
      "}",
    ].join("\n");

    const userPrompt = [
      "Lead context (JSON):",
      JSON.stringify(context, null, 2),
      "",
      "If the public application link is relevant, use the path /apply as the URL (client will prefix the site origin).",
    ].join("\n");

    const OPENAI_API_KEY = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
    if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");

    const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) {
      const errBody = await aiRes.text();
      throw new Error(`OpenAI API error (${aiRes.status}): ${errBody.substring(0, 300)}`);
    }

    const aiJson = await aiRes.json();
    const content = aiJson.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned no content");

    const parsed = JSON.parse(content) as {
      subject?: string;
      body_text?: string;
      body_html?: string;
      sms_text?: string;
      suggested_questions?: string[];
      suggested_actions?: { label: string; url: string }[];
    };

    const usage = aiJson.usage ?? {};

    // Persist draft.
    const { data: draft, error: draftErr } = await supabase
      .from("ai_drafts")
      .insert({
        lead_id,
        generated_by: user.id,
        model: "gpt-4o-mini",
        prompt_tokens: usage.prompt_tokens ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        subject: parsed.subject ?? null,
        body_text: parsed.body_text ?? null,
        body_html: parsed.body_html ?? null,
        sms_text: parsed.sms_text ?? null,
        suggested_questions: parsed.suggested_questions ?? [],
        suggested_actions: parsed.suggested_actions ?? [],
        context_snapshot: context,
      })
      .select("*")
      .single();

    if (draftErr) throw draftErr;

    await supabase.from("system_activity").insert({
      event_type: "AI_AUDIT",
      title: "Leasing draft generated",
      description: `Lead ${typedLead.first_name} ${typedLead.last_name} (${typedLead.email})`,
      actor_name: "GPT-4o Mini",
    });

    return new Response(JSON.stringify({ draft }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const message = (error as Error).message || "Unknown error";
    console.error("leasing-assistant error:", message);
    const status = /Authorization|token|Access denied/i.test(message) ? 401 : 400;
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });
  }
});
