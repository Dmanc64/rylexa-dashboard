import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";

/**
 * send-sms — Twilio SMS processor.
 *
 * Processes pending SMS notifications from the notification_queue table.
 * Can be invoked by:
 *   1. Cron scheduler (every 2 min) — sends service_role key
 *   2. Manual admin trigger — sends user JWT
 *
 * Picks up rows WHERE channel='sms' AND status='pending', sends via
 * Twilio REST API, and updates status to 'sent' or 'failed'.
 */
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return handleCorsPreFlight(req);
  }

  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // ── Auth ──
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Unauthorized" }, 401);
  }

  // ── Twilio credentials ──
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");

  if (!twilioSid || !twilioAuth || !twilioFrom) {
    return json({ error: "Twilio credentials not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_FROM_NUMBER in edge function secrets." }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    // ── Check feature flag ──
    const { data: flag } = await supabase
      .from("feature_flags")
      .select("value")
      .eq("key", "sms_notifications")
      .single();

    if (!flag?.value) {
      return json({ message: "SMS notifications feature is disabled." });
    }

    // ── Fetch pending SMS batch ──
    const { data: pending, error: fetchErr } = await supabase
      .from("notification_queue")
      .select("id, recipient_phone, recipient_name, body")
      .eq("channel", "sms")
      .eq("status", "pending")
      .not("recipient_phone", "is", null)
      .order("created_at", { ascending: true })
      .limit(50);

    if (fetchErr) throw fetchErr;

    if (!pending || pending.length === 0) {
      return json({ message: "No pending SMS to send.", sent: 0, failed: 0 });
    }

    let sent = 0;
    let failed = 0;

    // ── Process each SMS via Twilio REST API ──
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const basicAuth = btoa(`${twilioSid}:${twilioAuth}`);

    for (const sms of pending) {
      try {
        // Normalize phone number — ensure E.164 format
        let phone = sms.recipient_phone?.replace(/[^\d+]/g, "") ?? "";
        if (phone && !phone.startsWith("+")) {
          phone = "+1" + phone; // Default to US
        }

        if (!phone || phone.length < 10) {
          // Invalid phone — mark as failed
          await supabase
            .from("notification_queue")
            .update({
              status: "failed",
              error_message: "Invalid phone number",
              sent_at: new Date().toISOString(),
            })
            .eq("id", sms.id);
          failed++;
          continue;
        }

        const formBody = new URLSearchParams({
          To: phone,
          From: twilioFrom,
          Body: sms.body,
        });

        const twilioRes = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${basicAuth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formBody.toString(),
        });

        const twilioData = await twilioRes.json();

        if (twilioRes.ok && twilioData.sid) {
          // ── Success ──
          await supabase
            .from("notification_queue")
            .update({
              status: "sent",
              sms_sid: twilioData.sid,
              sent_at: new Date().toISOString(),
            })
            .eq("id", sms.id);
          sent++;
        } else {
          // ── Twilio error ──
          const errMsg = twilioData.message || twilioData.error_message || "Twilio API error";
          await supabase
            .from("notification_queue")
            .update({
              status: "failed",
              error_message: errMsg,
              sent_at: new Date().toISOString(),
            })
            .eq("id", sms.id);
          failed++;
        }
      } catch (smsErr) {
        // Per-message error — don't stop the batch
        const errMsg = smsErr instanceof Error ? smsErr.message : "Unknown error";
        await supabase
          .from("notification_queue")
          .update({
            status: "failed",
            error_message: errMsg,
            processed_at: new Date().toISOString(),
          })
          .eq("id", sms.id);
        failed++;
      }
    }

    // ── Log activity ──
    if (sent > 0 || failed > 0) {
      await supabase.from("system_activity").insert({
        event_type: "SMS_BATCH",
        title: "SMS Batch Processed",
        description: `Sent: ${sent}, Failed: ${failed} of ${pending.length} messages`,
        actor_name: "SMS Engine",
      });
    }

    return json({ success: true, sent, failed, total: pending.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ error: message }, 500);
  }
});
