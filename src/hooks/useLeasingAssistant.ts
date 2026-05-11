'use client'

import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'

export type SuggestedAction = { label: string; url: string }

export type AiDraft = {
  id: string
  lead_id: string
  generated_by: string | null
  model: string
  prompt_tokens: number | null
  completion_tokens: number | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  sms_text: string | null
  suggested_questions: string[]
  suggested_actions: SuggestedAction[]
  context_snapshot: unknown
  sent_at: string | null
  sent_channel: 'sms' | 'email' | 'both' | null
  sent_by: string | null
  created_at: string
}

/**
 * useLeasingAssistant
 *
 * - generateDraft(leadId) — calls the leasing-assistant edge function and
 *   returns the persisted draft row. Throws on error; callers are expected
 *   to display the draft in a modal for human review before send.
 *
 * - sendEmail({ draft, to }) — delivers the draft via the send-email edge
 *   function (provider-isolated; currently Resend). Marks the draft as sent
 *   and logs a lead_activities row.
 *
 * - sendSmsViaTwilio({ draft, phone }) — invokes the existing Twilio-backed
 *   send-sms flow by queueing into notification_queue, then immediately
 *   triggering the drain. Marks draft sent and logs activity.
 *
 * - markSent({ draftId, leadId, channel, summary }) — used by both send paths
 *   and can also be called directly (e.g. when a rep copies the email to a
 *   personal client).
 */
export function useLeasingAssistant() {
  const generateDraft = useMutation({
    mutationFn: async (leadId: string): Promise<AiDraft> => {
      const { data, error } = await supabase.functions.invoke('leasing-assistant', {
        body: { lead_id: leadId },
      })
      if (error) throw new Error(error.message)
      const payload = data as { draft?: AiDraft; error?: string }
      if (payload?.error) throw new Error(payload.error)
      if (!payload?.draft) throw new Error('No draft returned')
      return payload.draft
    },
    onError: (err: Error) => toast.error('Draft generation failed: ' + err.message),
  })

  const markSent = useMutation({
    mutationFn: async ({
      draftId,
      leadId,
      channel,
      summary,
    }: {
      draftId: string
      leadId: string
      channel: 'sms' | 'email' | 'both'
      summary: string
    }) => {
      const { data: userRes } = await supabase.auth.getUser()
      const now = new Date().toISOString()

      const { error: draftErr } = await supabase
        .from('ai_drafts')
        .update({
          sent_at: now,
          sent_channel: channel,
          sent_by: userRes.user?.id ?? null,
        })
        .eq('id', draftId)
      if (draftErr) throw draftErr

      const activityType = channel === 'sms' ? 'text_sent' : 'email_sent'
      const { error: actErr } = await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: activityType,
        description: summary,
        created_by: userRes.user?.id ?? null,
      })
      if (actErr) throw actErr
    },
    onError: (err: Error) => toast.error('Failed to log send: ' + err.message),
  })

  const sendEmail = useMutation({
    mutationFn: async ({
      draft,
      to,
    }: {
      draft: AiDraft
      to: string
    }) => {
      if (!draft.subject || (!draft.body_html && !draft.body_text)) {
        throw new Error('Draft is missing subject or body')
      }
      if (!to) throw new Error('Recipient email required')

      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          to,
          subject: draft.subject,
          html: draft.body_html ?? undefined,
          text: draft.body_text ?? undefined,
        },
      })
      if (error) throw new Error(error.message)
      const payload = data as { success?: boolean; error?: string; provider_id?: string }
      if (payload?.error) throw new Error(payload.error)
      if (!payload?.success) throw new Error('Email send returned no success flag')

      await markSent.mutateAsync({
        draftId: draft.id,
        leadId: draft.lead_id,
        channel: 'email',
        summary: `Email sent to ${to}: ${draft.subject}`,
      })

      return payload.provider_id ?? null
    },
    onSuccess: () => toast.success('Email sent'),
    onError: (err: Error) => toast.error('Email send failed: ' + err.message),
  })

  const sendSmsViaTwilio = useMutation({
    mutationFn: async ({
      draft,
      phone,
    }: {
      draft: AiDraft
      phone: string
    }) => {
      if (!draft.sms_text) throw new Error('Draft has no SMS text')
      if (!phone) throw new Error('Recipient phone required')

      // Queue into notification_queue; existing send-sms drains & posts to Twilio.
      const { error: queueErr } = await supabase.from('notification_queue').insert({
        channel: 'sms',
        recipient_phone: phone,
        body: draft.sms_text,
        status: 'pending',
      })
      if (queueErr) throw queueErr

      const { data, error } = await supabase.functions.invoke('send-sms', {
        body: {},
      })
      if (error) throw new Error(error.message)
      const payload = data as { sent?: number; failed?: number; error?: string }
      if (payload?.error) throw new Error(payload.error)
      if (payload && payload.failed && !payload.sent) {
        throw new Error('Twilio reported the message as failed')
      }

      await markSent.mutateAsync({
        draftId: draft.id,
        leadId: draft.lead_id,
        channel: 'sms',
        summary: `SMS sent to ${phone}`,
      })
    },
    onSuccess: () => toast.success('SMS sent'),
    onError: (err: Error) => toast.error('SMS send failed: ' + err.message),
  })

  return {
    generateDraft,
    sendEmail,
    sendSmsViaTwilio,
    markSent,
  }
}
