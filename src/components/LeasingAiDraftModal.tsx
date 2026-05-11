'use client'

import { useEffect, useState } from 'react'
import {
  Sparkles, Loader2, Mail, MessageSquare, Copy, Send,
  CheckCircle2, HelpCircle, ExternalLink, AlertTriangle, RotateCw,
} from 'lucide-react'
import { toast } from 'sonner'
import AccessibleModal from '@/components/AccessibleModal'
import type { Lead } from '@/hooks/useLeadsCRM'
import {
  useLeasingAssistant,
  type AiDraft,
  type SuggestedAction,
} from '@/hooks/useLeasingAssistant'

type Props = {
  isOpen: boolean
  onClose: () => void
  lead: Lead | null
  onSent?: () => void
}

type TabKey = 'email' | 'sms'

export default function LeasingAiDraftModal({ isOpen, onClose, lead, onSent }: Props) {
  const { generateDraft, sendEmail, sendSmsViaTwilio } = useLeasingAssistant()
  const [draft, setDraft] = useState<AiDraft | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('email')

  // Editable copies — separate from the persisted draft so edits stay client-side
  // unless/until the user hits send. (Keeps the original draft intact in the DB
  // for auditability.)
  const [subject, setSubject] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [smsText, setSmsText] = useState('')
  const [toEmail, setToEmail] = useState('')
  const [toPhone, setToPhone] = useState('')

  const runGenerate = async (leadId: string, hasPhone: boolean) => {
    setGenerateError(null)
    try {
      const result = await generateDraft.mutateAsync(leadId)
      setDraft(result)
      setSubject(result.subject ?? '')
      setBodyText(result.body_text ?? '')
      setSmsText(result.sms_text ?? '')
      if (!hasPhone) setTab('email')
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    if (!isOpen) {
      setDraft(null)
      setGenerateError(null)
      setSubject('')
      setBodyText('')
      setSmsText('')
      setToEmail('')
      setToPhone('')
      setTab('email')
      return
    }
    if (!lead) return

    setToEmail(lead.email || '')
    setToPhone(lead.phone || '')
    void runGenerate(lead.id, !!lead.phone)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, lead?.id])

  if (!lead) return null

  const handleCopyEmail = async () => {
    const payload = `Subject: ${subject}\n\n${bodyText}`
    try {
      await navigator.clipboard.writeText(payload)
      toast.success('Email copied to clipboard')
    } catch {
      toast.error('Clipboard not available')
    }
  }

  const handleCopySms = async () => {
    try {
      await navigator.clipboard.writeText(smsText)
      toast.success('SMS copied to clipboard')
    } catch {
      toast.error('Clipboard not available')
    }
  }

  const handleSendEmail = async () => {
    if (!draft) return
    if (!toEmail.trim()) {
      toast.error('Enter a recipient email')
      return
    }
    await sendEmail.mutateAsync({
      draft: {
        ...draft,
        subject,
        body_text: bodyText,
        // Keep the original HTML (so formatting isn't lost). If user edited
        // body_text heavily they can re-generate or fall back to copy.
        body_html: draft.body_html,
      },
      to: toEmail.trim(),
    })
    onSent?.()
    onClose()
  }

  const handleSendSms = async () => {
    if (!draft) return
    if (!toPhone.trim()) {
      toast.error('Enter a recipient phone')
      return
    }
    await sendSmsViaTwilio.mutateAsync({
      draft: { ...draft, sms_text: smsText },
      phone: toPhone.trim(),
    })
    onSent?.()
    onClose()
  }

  const generating = generateDraft.isPending
  const sendingEmail = sendEmail.isPending
  const sendingSms = sendSmsViaTwilio.isPending

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="AI-Drafted Response"
      subtitle={`For ${lead.first_name} ${lead.last_name} · ${lead.email}`}
      size="max-w-2xl"
    >
      {/* Header band */}
      <div className="px-8 pt-6 pb-4 border-b border-slate-100 bg-gradient-to-br from-violet-50 to-white">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-violet-600" />
          <span className="text-[10px] font-black text-violet-700 uppercase tracking-[0.2em]">
            Leasing AI Assistant
          </span>
          {draft && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 text-[10px] font-black uppercase tracking-wider">
              <CheckCircle2 size={10} /> Draft ready
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Review and edit below, then send. Sends are logged to the lead&apos;s activity timeline.
        </p>
      </div>

      {/* Body */}
      <div className="p-8 space-y-6">
        {generating ? (
          <div className="py-16 text-center">
            <Loader2 className="animate-spin mx-auto text-violet-500 mb-3" size={28} />
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              Drafting a personalized response…
            </p>
          </div>
        ) : generateError ? (
          <div className="py-12 px-6 text-center space-y-4">
            <AlertTriangle className="mx-auto text-red-500" size={32} />
            <div>
              <p className="text-xs font-black text-red-600 uppercase tracking-widest mb-2">
                Couldn&apos;t generate draft
              </p>
              <p className="text-xs text-slate-500 break-words">{generateError}</p>
              {generateError.toLowerCase().includes('404') && (
                <p className="text-[11px] text-slate-400 mt-3">
                  Tip: make sure the <code className="font-mono">leasing-assistant</code> edge function has been deployed
                  (<code className="font-mono">supabase functions deploy leasing-assistant</code>) and that
                  <code className="font-mono"> OPENAI_API_KEY</code> is set in function secrets.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => lead && runGenerate(lead.id, !!lead.phone)}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-violet-700 transition-all"
            >
              <RotateCw size={12} /> Try Again
            </button>
          </div>
        ) : !draft ? null : (
          <>
            {/* Tabs */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTab('email')}
                className={
                  'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ' +
                  (tab === 'email'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
                }
              >
                <Mail size={12} /> Email
              </button>
              <button
                type="button"
                onClick={() => setTab('sms')}
                className={
                  'px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 transition-all ' +
                  (tab === 'sms'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200')
                }
              >
                <MessageSquare size={12} /> SMS
              </button>
            </div>

            {tab === 'email' ? (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Recipient
                  </label>
                  <input
                    type="email"
                    value={toEmail}
                    onChange={(e) => setToEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-violet-500 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-violet-500 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Body
                  </label>
                  <textarea
                    value={bodyText}
                    onChange={(e) => setBodyText(e.target.value)}
                    rows={12}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-violet-500 transition-all resize-none whitespace-pre-wrap"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                    Recipient phone
                  </label>
                  <input
                    type="tel"
                    value={toPhone}
                    onChange={(e) => setToPhone(e.target.value)}
                    placeholder="+1 555 555 5555"
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-violet-500 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex justify-between">
                    <span>SMS Message</span>
                    <span className="text-slate-400">{smsText.length} chars</span>
                  </label>
                  <textarea
                    value={smsText}
                    onChange={(e) => setSmsText(e.target.value)}
                    rows={6}
                    className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs leading-relaxed outline-none focus:ring-2 focus:ring-violet-500 transition-all resize-none whitespace-pre-wrap"
                  />
                </div>
              </div>
            )}

            {/* Suggested questions */}
            {draft.suggested_questions.length > 0 && (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-2">
                <div className="flex items-center gap-2">
                  <HelpCircle size={12} className="text-amber-600" />
                  <h4 className="text-[10px] font-black text-amber-700 uppercase tracking-[0.2em]">
                    Qualifying questions to ask
                  </h4>
                </div>
                <ul className="list-disc list-inside space-y-1 text-xs text-amber-900">
                  {draft.suggested_questions.map((q, idx) => (
                    <li key={idx}>{q}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggested actions */}
            {draft.suggested_actions.length > 0 && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2">
                <h4 className="text-[10px] font-black text-emerald-700 uppercase tracking-[0.2em]">
                  Suggested next steps
                </h4>
                <ul className="space-y-1.5">
                  {draft.suggested_actions.map((a: SuggestedAction, idx: number) => (
                    <li key={idx} className="flex items-center gap-2 text-xs">
                      <ExternalLink size={10} className="text-emerald-600" />
                      <span className="font-bold text-emerald-900">{a.label}</span>
                      <span className="text-emerald-600 font-mono text-[10px]">{a.url}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-8 py-6 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onClose}
          className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-900 transition-colors"
        >
          Cancel
        </button>
        <div className="flex items-center gap-3">
          {draft && tab === 'email' && (
            <>
              <button
                type="button"
                onClick={handleCopyEmail}
                className="px-4 py-3 bg-white border border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:border-slate-400 hover:text-slate-900 transition-all flex items-center gap-2"
              >
                <Copy size={12} /> Copy
              </button>
              <button
                type="button"
                onClick={handleSendEmail}
                disabled={sendingEmail}
                className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-violet-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
              >
                {sendingEmail ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                Send Email
              </button>
            </>
          )}
          {draft && tab === 'sms' && (
            <>
              <button
                type="button"
                onClick={handleCopySms}
                className="px-4 py-3 bg-white border border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:border-slate-400 hover:text-slate-900 transition-all flex items-center gap-2"
              >
                <Copy size={12} /> Copy
              </button>
              <button
                type="button"
                onClick={handleSendSms}
                disabled={sendingSms}
                className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-violet-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
              >
                {sendingSms ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                Send SMS
              </button>
            </>
          )}
        </div>
      </div>
    </AccessibleModal>
  )
}
