'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  X, Send, Users, Search, Phone, FileText,
  AlertCircle, Loader2, CheckCircle2
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useSendSMS, useSendBulkSMS, useSMSTemplates,
  fetchSMSRecipients, type BulkSMSTarget
} from '@/hooks/useSMS'
import { useProperties } from '@/hooks/useProperties'

type SendMode = 'single' | 'bulk'

type Recipient = {
  id: string
  name: string
  phone: string
  property_id: string
  property_name: string
  unit_name: string
}

export default function ComposeSMSModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  // Mode
  const [mode, setMode] = useState<SendMode>('single')

  // Single mode
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [recipientSearch, setRecipientSearch] = useState('')
  const [selectedRecipient, setSelectedRecipient] = useState<Recipient | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)

  // Bulk mode
  const [bulkTarget, setBulkTarget] = useState<'all_active' | 'property'>('all_active')
  const [selectedPropertyId, setSelectedPropertyId] = useState('')

  // Message
  const [messageBody, setMessageBody] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')

  // Data
  const { data: templates = [] } = useSMSTemplates()
  const { properties } = useProperties()
  const sendSMS = useSendSMS()
  const sendBulkSMS = useSendBulkSMS()

  // Fetch recipients on open
  useEffect(() => {
    if (isOpen) {
      fetchSMSRecipients().then(setRecipients)
    }
  }, [isOpen])

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setMode('single')
      setRecipientSearch('')
      setSelectedRecipient(null)
      setShowDropdown(false)
      setBulkTarget('all_active')
      setSelectedPropertyId('')
      setMessageBody('')
      setSelectedTemplateId('')
    }
  }, [isOpen])

  // Template selection
  const handleTemplateSelect = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId)
    if (templateId) {
      const template = templates.find(t => t.id === templateId)
      if (template) {
        setMessageBody(template.body)
      }
    }
  }, [templates])

  // Filter recipients
  const filteredRecipients = recipients.filter(r => {
    const q = recipientSearch.toLowerCase()
    return r.name.toLowerCase().includes(q) ||
           r.phone.includes(q) ||
           r.property_name.toLowerCase().includes(q)
  })

  // Character count
  const charCount = messageBody.length
  const segments = Math.ceil(charCount / 160) || 1
  const isOverLimit = charCount > 160

  // Send handler
  const handleSend = async () => {
    if (!messageBody.trim()) {
      toast.error('Please enter a message.')
      return
    }

    try {
      if (mode === 'single') {
        if (!selectedRecipient) {
          toast.error('Please select a recipient.')
          return
        }
        await sendSMS.mutateAsync({
          recipient_phone: selectedRecipient.phone,
          recipient_name: selectedRecipient.name,
          body: messageBody,
        })
        toast.success(`SMS queued for ${selectedRecipient.name}`)
      } else {
        const target: BulkSMSTarget = bulkTarget === 'all_active'
          ? { type: 'all_active' }
          : { type: 'property', property_id: selectedPropertyId }

        if (bulkTarget === 'property' && !selectedPropertyId) {
          toast.error('Please select a property.')
          return
        }

        const result = await sendBulkSMS.mutateAsync({ target, body: messageBody })
        toast.success(`${result.queued} SMS messages queued`)
      }
      onClose()
    } catch (err: any) {
      toast.error(err.message || 'Failed to queue SMS')
    }
  }

  if (!isOpen) return null

  const isSending = sendSMS.isPending || sendBulkSMS.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-[2rem] shadow-2xl w-full max-w-lg border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100">
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Compose</p>
            <h3 className="text-xl font-black italic tracking-tighter">Send SMS</h3>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* MODE TOGGLE */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
            <button
              onClick={() => setMode('single')}
              className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
                mode === 'single' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'
              }`}
            >
              <Phone size={14} /> Single
            </button>
            <button
              onClick={() => setMode('bulk')}
              className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center justify-center gap-2 ${
                mode === 'bulk' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'
              }`}
            >
              <Users size={14} /> Bulk
            </button>
          </div>

          {/* RECIPIENT SELECTION */}
          {mode === 'single' ? (
            <div className="relative">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
                Recipient
              </label>
              {selectedRecipient ? (
                <div className="flex items-center justify-between p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
                  <div>
                    <p className="font-bold text-sm text-slate-900">{selectedRecipient.name}</p>
                    <p className="text-[10px] text-slate-500 font-mono">{selectedRecipient.phone} • {selectedRecipient.property_name} {selectedRecipient.unit_name}</p>
                  </div>
                  <button
                    onClick={() => { setSelectedRecipient(null); setRecipientSearch('') }}
                    className="text-slate-400 hover:text-red-500 p-1"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={recipientSearch}
                      onChange={e => { setRecipientSearch(e.target.value); setShowDropdown(true) }}
                      onFocus={() => setShowDropdown(true)}
                      placeholder="Search tenant by name or phone..."
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                    />
                  </div>
                  {showDropdown && filteredRecipients.length > 0 && (
                    <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                      {filteredRecipients.slice(0, 10).map(r => (
                        <button
                          key={r.id}
                          onClick={() => { setSelectedRecipient(r); setShowDropdown(false); setRecipientSearch('') }}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0"
                        >
                          <p className="font-bold text-sm text-slate-900">{r.name}</p>
                          <p className="text-[10px] text-slate-400">{r.phone} • {r.property_name} {r.unit_name}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
                Send To
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setBulkTarget('all_active')}
                  className={`flex-1 p-3 rounded-xl border text-sm font-bold transition-all ${
                    bulkTarget === 'all_active'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  All Active Tenants
                </button>
                <button
                  onClick={() => setBulkTarget('property')}
                  className={`flex-1 p-3 rounded-xl border text-sm font-bold transition-all ${
                    bulkTarget === 'property'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  By Property
                </button>
              </div>
              {bulkTarget === 'property' && (
                <select
                  value={selectedPropertyId}
                  onChange={e => setSelectedPropertyId(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/30 appearance-none"
                >
                  <option value="">Select a property...</option>
                  {properties.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* TEMPLATE SELECTOR */}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
              <FileText size={12} className="inline mr-1" />Template (Optional)
            </label>
            <select
              value={selectedTemplateId}
              onChange={e => handleTemplateSelect(e.target.value)}
              className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:outline-none focus:ring-2 focus:ring-emerald-500/30 appearance-none"
            >
              <option value="">Write custom message...</option>
              {templates.filter(t => t.is_active).map(t => (
                <option key={t.id} value={t.id}>
                  {t.slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — {t.description?.slice(0, 40)}
                </option>
              ))}
            </select>
          </div>

          {/* MESSAGE INPUT */}
          <div>
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-2">
              Message
            </label>
            <textarea
              value={messageBody}
              onChange={e => setMessageBody(e.target.value)}
              rows={4}
              placeholder="Type your SMS message..."
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
            <div className="flex items-center justify-between mt-2">
              <p className="text-[10px] text-slate-400">
                {mode === 'bulk' && (
                  <span className="text-emerald-600 font-bold">Use {'{{tenant_name}}'} for personalization • </span>
                )}
                Available: {'{{tenant_name}}, {{amount}}, {{property}}, {{unit}}, {{due_date}}'}
              </p>
              <p className={`text-[10px] font-bold ${isOverLimit ? 'text-amber-600' : 'text-slate-400'}`}>
                {charCount}/160 {segments > 1 && `(${segments} segments)`}
              </p>
            </div>
            {isOverLimit && (
              <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                <AlertCircle size={12} /> Message exceeds 160 chars — will be sent as {segments} segments (higher cost).
              </p>
            )}
          </div>
        </div>

        {/* FOOTER */}
        <div className="p-6 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-5 py-3 text-slate-500 font-bold text-xs hover:text-slate-900 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || !messageBody.trim()}
            className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all active:scale-95 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isSending ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Queueing...
              </>
            ) : (
              <>
                <Send size={14} />
                {mode === 'bulk' ? 'Send to All' : 'Send SMS'}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
