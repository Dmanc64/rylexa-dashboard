import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders, handleCorsPreFlight } from "../_shared/cors.ts";

/**
 * notify-application-received — send an acknowledgment email to a prospect
 * immediately after they submit a rental application.
 *
 * Invoked by the public /apply page (src/app/(public)/apply/page.tsx) via
 * supabase.functions.invoke() right after the applications INSERT succeeds.
 *
 * Auth model:
 *   The applicant is anonymous and Supabase's verify_jwt gateway rejects
 *   calls that don't carry a user access token. This function is therefore
 *   deployed with verify_jwt=false. Security comes from server-side checks:
 *     - application_id must reference an existing row
 *     - row must be < 10 min old (freshness guard — no historic replays)
 *     - row must have an email
 *     - acknowledgment_email_sent_at must be NULL (idempotent — one send)
 *     - application row is refetched via service role so the client cannot
 *       spoof first_name / email / property details used in the email body
 *
 * Idempotency:
 *   applications.acknowledgment_email_sent_at is set after a successful
 *   send. Subsequent invocations for the same application_id short-circuit
 *   with { already_sent: true } so refreshes or replay cannot spam the
 *   applicant.
 *
 * Anti-abuse:
 *   - Only sends if the application was created within the last 10 minutes
 *     (post-submit acknowledgment, not arbitrary historic lookups).
 *   - Only sends if application.email exists.
 *
 * Request body:
 *   { "application_id": "<uuid>" }
 *
 * Secrets required (same as send-email):
 *   RESEND_API_KEY
 *   EMAIL_FROM_ADDRESS           e.g. "Rylexa <noreply@rylexa.com>"
 *   EMAIL_REPLY_TO_ADDRESS (opt)
 */

type DeliverArgs = {
  to: string;
  from: string;
  reply_to?: string;
  subject: string;
  html: string;
  text: string;
};

type DeliverResult =
  | { ok: true; provider_id: string }
  | { ok: false; error: string };

async function deliverViaProvider(args: DeliverArgs): Promise<DeliverResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: args.from,
      to: [args.to],
      subject: args.subject,
      html: args.html,
      text: args.text,
      ...(args.reply_to ? { reply_to: args.reply_to } : {}),
    }),
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

function buildEmail(args: {
  firstName: string;
  propertyName: string | null;
  unitName: string | null;
}): { subject: string; html: string; text: string } {
  const { firstName, propertyName, unitName } = args;
  const subject = "We received your rental application";

  const propertyLine =
    propertyName && unitName
      ? `for <strong>${escapeHtml(propertyName)}</strong>, unit ${escapeHtml(unitName)}`
      : propertyName
        ? `for <strong>${escapeHtml(propertyName)}</strong>`
        : "";

  const propertyLineText =
    propertyName && unitName
      ? `for ${propertyName}, unit ${unitName}`
      : propertyName
        ? `for ${propertyName}`
        : "";

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background:#0f172a;padding:28px 32px;">
                <div style="font-weight:900;font-style:italic;letter-spacing:-0.03em;font-size:22px;color:#ffffff;">
                  RYLEXA<span style="color:#059669;">.PM</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 16px 0;font-size:22px;font-weight:800;color:#0f172a;">
                  Thanks, ${escapeHtml(firstName) || "there"} — we got it.
                </h1>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#334155;">
                  Your rental application ${propertyLine} has been received.
                </p>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#334155;">
                  A property manager will review it and reach out shortly. You don't need to do anything further right now — if we need more information, we'll contact you at the email or phone number you provided.
                </p>
                <p style="margin:24px 0 0 0;font-size:13px;color:#64748b;">
                  If you didn't submit this application, please reply to this email and let us know.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px;border-top:1px solid #e2e8f0;background:#f8fafc;">
                <p style="margin:0;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.1em;text-transform:uppercase;">
                  Rylexa Property Management
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    `Thanks, ${firstName || "there"} — we got it.`,
    "",
    `Your rental application ${propertyLineText} has been received.`,
    "",
    "A property manager will review it and reach out shortly. You don't need to do anything further right now — if we need more information, we'll contact you at the email or phone number you provided.",
    "",
    "If you didn't submit this application, please reply to this email and let us know.",
    "",
    "— Rylexa Property Management",
  ].join("\n");

  return { subject, html, text };
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCorsPreFlight(req);

  const corsHeaders = getCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const fromAddress = Deno.env.get("EMAIL_FROM_ADDRESS");
  const defaultReplyTo = Deno.env.get("EMAIL_REPLY_TO_ADDRESS") || undefined;
  if (!fromAddress) {
    return json({ error: "EMAIL_FROM_ADDRESS not configured" }, 500);
  }

  let body: { application_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const applicationId = body.application_id;
  if (!applicationId || typeof applicationId !== "string") {
    return json({ error: "application_id is required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Fetch the application + unit + property in one query so the email body
  // can reference what the applicant actually applied for.
  const { data: app, error: appErr } = await supabase
    .from("applications")
    .select(
      "id, first_name, email, created_at, acknowledgment_email_sent_at, units(name, properties(name))",
    )
    .eq("id", applicationId)
    .single();

  if (appErr || !app) {
    return json({ error: "Application not found" }, 404);
  }

  if (!app.email) {
    return json({ error: "Application has no email address" }, 400);
  }

  // Idempotency: already sent.
  if (app.acknowledgment_email_sent_at) {
    return json({ success: true, already_sent: true });
  }

  // Freshness guard: only acknowledge submissions within the last 10 minutes.
  // Prevents someone from replaying this against old applications.
  const createdAt = new Date(app.created_at as string).getTime();
  if (Number.isFinite(createdAt) && Date.now() - createdAt > 10 * 60 * 1000) {
    return json(
      { error: "Application is too old to acknowledge" },
      403,
    );
  }

  // deno-lint-ignore no-explicit-any
  const unit = (app as any).units;
  const unitName = unit?.name ?? null;
  const propertyName = unit?.properties?.name ?? null;

  const { subject, html, text } = buildEmail({
    firstName: (app.first_name as string) || "",
    propertyName,
    unitName,
  });

  const result = await deliverViaProvider({
    to: app.email as string,
    from: fromAddress,
    reply_to: defaultReplyTo,
    subject,
    html,
    text,
  });

  if (!result.ok) {
    await supabase.from("system_activity").insert({
      event_type: "EMAIL_FAILED",
      title: "Application acknowledgment email failed",
      description: `To: ${app.email} — ${result.error}`,
      actor_name: "Application Intake",
    });
    return json({ error: result.error }, 502);
  }

  // Mark as sent so duplicate invocations short-circuit.
  const nowIso = new Date().toISOString();
  await supabase
    .from("applications")
    .update({ acknowledgment_email_sent_at: nowIso })
    .eq("id", applicationId);

  // Mirror into notification_queue as an already-sent row for audit trail.
  await supabase.from("notification_queue").insert({
    recipient_email: app.email,
    recipient_name: app.first_name,
    subject,
    body: html,
    channel: "email",
    status: "sent",
    processed_at: nowIso,
    related_entity_id: applicationId,
  });

  await supabase.from("system_activity").insert({
    event_type: "EMAIL_SENT",
    title: "Application acknowledgment email sent",
    description: `To: ${app.email} — ${subject}`,
    actor_name: "Application Intake",
  });

  return json({ success: true, provider_id: result.provider_id });
});
