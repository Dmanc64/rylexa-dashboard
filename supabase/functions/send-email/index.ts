import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";
import { verifyAuth } from "../_shared/auth.ts";

/**
 * send-email — provider-isolated outbound email.
 *
 * All app code calls this function. The provider implementation below is
 * currently Resend; swapping to SendGrid / Postmark / SES later means
 * replacing the `deliverViaProvider` body + env vars here only. No caller
 * changes required.
 *
 * Two invocation modes:
 *   1. Direct send — POST { to, subject, html, text?, reply_to?, from? }
 *      Sends synchronously and returns { success, provider_id }.
 *   2. Queue drain — POST {} (empty body, or { drain: true })
 *      Processes pending rows in notification_queue where channel='email'.
 *      Used by cron or on-demand admin trigger.
 *
 * Secrets required:
 *   RESEND_API_KEY               — provider API key
 *   EMAIL_FROM_ADDRESS           — verified sender address (e.g. "Rylexa <noreply@rylexa.com>")
 *   EMAIL_REPLY_TO_ADDRESS (opt) — default reply-to address
 */

// ── Provider layer ─────────────────────────────────────────────────────────
// Keep this the only place that knows about the provider. Swap the body to
// change providers; the exported signature stays the same.

type DeliverArgs = {
  to: string | string[];
  from: string;
  reply_to?: string;
  subject: string;
  html?: string;
  text?: string;
};

type DeliverResult =
  | { ok: true; provider_id: string }
  | { ok: false; error: string };

async function deliverViaProvider(args: DeliverArgs): Promise<DeliverResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      error:
        "RESEND_API_KEY not configured. Set it in edge function secrets before sending email.",
    };
  }

  const payload: Record<string, unknown> = {
    from: args.from,
    to: Array.isArray(args.to) ? args.to : [args.to],
    subject: args.subject,
  };
  if (args.html) payload.html = args.html;
  if (args.text) payload.text = args.text;
  if (args.reply_to) payload.reply_to = args.reply_to;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (body as { message?: string }).message ||
      (body as { error?: string }).error ||
      `Resend error (${res.status})`;
    return { ok: false, error: msg };
  }

  const id = (body as { id?: string }).id ?? "unknown";
  return { ok: true, provider_id: id };
}

// ── Handler ────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);

  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Unauthorized" }, 401);

  // Any authenticated user can trigger — providers may impose their own limits.
  try {
    await verifyAuth(req);
  } catch (e) {
    return json({ error: (e as Error).message }, 401);
  }

  const fromAddress = Deno.env.get("EMAIL_FROM_ADDRESS");
  const defaultReplyTo = Deno.env.get("EMAIL_REPLY_TO_ADDRESS") || undefined;
  if (!fromAddress) {
    return json(
      {
        error:
          "EMAIL_FROM_ADDRESS not configured. Set it to a verified sender address (e.g. 'Rylexa <noreply@your-domain.com>').",
      },
      500,
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body: Record<string, unknown> = {};
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const wantsDirectSend =
    typeof body.to === "string" || Array.isArray(body.to);

  // ── Mode 1: direct send ──
  if (wantsDirectSend) {
    const to = body.to as string | string[];
    const subject = String(body.subject ?? "");
    const html = typeof body.html === "string" ? body.html : undefined;
    const text = typeof body.text === "string" ? body.text : undefined;
    const reply_to =
      typeof body.reply_to === "string" ? body.reply_to : defaultReplyTo;
    const from = typeof body.from === "string" ? body.from : fromAddress;

    if (!subject || (!html && !text)) {
      return json({ error: "subject and (html or text) are required" }, 400);
    }

    const result = await deliverViaProvider({
      to,
      from,
      reply_to,
      subject,
      html,
      text,
    });

    if (!result.ok) {
      await supabase.from("system_activity").insert({
        event_type: "EMAIL_FAILED",
        title: "Email send failed",
        description: `To: ${Array.isArray(to) ? to.join(", ") : to} — ${result.error}`,
        actor_name: "Email Engine",
      });
      return json({ error: result.error }, 502);
    }

    await supabase.from("system_activity").insert({
      event_type: "EMAIL_SENT",
      title: "Email sent",
      description: `To: ${Array.isArray(to) ? to.join(", ") : to} — ${subject}`,
      actor_name: "Email Engine",
    });

    return json({ success: true, provider_id: result.provider_id });
  }

  // ── Mode 2: queue drain ──
  const { data: pending, error: fetchErr } = await supabase
    .from("notification_queue")
    .select("id, recipient_email, recipient_name, subject, body")
    .eq("channel", "email")
    .eq("status", "pending")
    .not("recipient_email", "is", null)
    .order("created_at", { ascending: true })
    .limit(50);

  if (fetchErr) return json({ error: fetchErr.message }, 500);
  if (!pending || pending.length === 0) {
    return json({ message: "No pending email to send.", sent: 0, failed: 0 });
  }

  let sent = 0;
  let failed = 0;

  for (const row of pending) {
    const result = await deliverViaProvider({
      to: row.recipient_email as string,
      from: fromAddress,
      reply_to: defaultReplyTo,
      subject: (row.subject as string) || "(no subject)",
      html: (row.body as string) || undefined,
      text: (row.body as string) || undefined,
    });

    if (result.ok) {
      await supabase
        .from("notification_queue")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          email_message_id: result.provider_id,
        })
        .eq("id", row.id);
      sent++;
    } else {
      await supabase
        .from("notification_queue")
        .update({
          status: "failed",
          error_message: result.error,
          sent_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed++;
    }
  }

  await supabase.from("system_activity").insert({
    event_type: "EMAIL_BATCH",
    title: "Email Batch Processed",
    description: `Sent: ${sent}, Failed: ${failed} of ${pending.length} messages`,
    actor_name: "Email Engine",
  });

  return json({ success: true, sent, failed, total: pending.length });
});
