'use client'

import { useState, useEffect } from 'react'
import { Search, Users, Megaphone, Building2, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import AccessibleModal from '@/components/AccessibleModal'
import {
  useCreateConversation,
  fetchRecipientOptions,
  fetchPropertyOptions,
  getPropertyParticipants,
  getAllTenantOwnerUserIds,
  getRoleColor,
  type RecipientOption,
  type ConversationType,
} from '@/hooks/useMessages'

interface ComposeMessageModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated?: (conversationId: string) => void
}

export default function ComposeMessageModal({ isOpen, onClose, onCreated }: ComposeMessageModalProps) {
  const [type, setType] = useState<ConversationType>('direct')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [propertyId, setPropertyId] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  // Data
  const [recipients, setRecipients] = useState<RecipientOption[]>([])
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([])
  const [loadingRecipients, setLoadingRecipients] = useState(false)

  const createConversation = useCreateConversation()

  useEffect(() => {
    if (!isOpen) return
    // Reset form
    setType('direct')
    setSubject('')
    setMessage('')
    setSelectedUserIds([])
    setPropertyId('')
    setSearchQuery('')

    // Load data
    setLoadingRecipients(true)
    Promise.all([
      fetchRecipientOptions(),
      fetchPropertyOptions(),
    ]).then(([r, p]) => {
      setRecipients(r)
      setProperties(p)
    }).finally(() => setLoadingRecipients(false))
  }, [isOpen])

  const filteredRecipients = recipients.filter(r => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return (
      r.full_name.toLowerCase().includes(q) ||
      r.role.toLowerCase().includes(q) ||
      (r.entity_label?.toLowerCase().includes(q) ?? false)
    )
  })

  // Group recipients by role
  const groupedRecipients = filteredRecipients.reduce<Record<string, RecipientOption[]>>((acc, r) => {
    if (!acc[r.role]) acc[r.role] = []
    acc[r.role].push(r)
    return acc
  }, {})

  const toggleRecipient = (userId: string) => {
    setSelectedUserIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const handleSubmit = async () => {
    if (!subject.trim()) { toast.error('Subject is required'); return }
    if (!message.trim()) { toast.error('Message is required'); return }

    let participantIds = selectedUserIds

    if (type === 'announcement') {
      // Auto-populate participants based on property scope
      if (propertyId) {
        participantIds = await getPropertyParticipants(propertyId)
      } else {
        participantIds = await getAllTenantOwnerUserIds()
      }

      if (participantIds.length === 0) {
        toast.error('No recipients found for this announcement')
        return
      }
    } else {
      if (participantIds.length === 0) {
        toast.error('Select at least one recipient')
        return
      }
    }

    const result = await createConversation.mutateAsync({
      conversation_type: type,
      subject: subject.trim(),
      participant_user_ids: participantIds,
      property_id: propertyId || undefined,
      initial_message: message.trim(),
    })

    if (result?.id) {
      onCreated?.(result.id)
    }
    onClose()
  }

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="New Conversation"
      subtitle="Start a direct message or broadcast an announcement"
      size="max-w-2xl"
    >
      <div className="p-6 space-y-6">

        {/* TYPE SELECTOR */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3">
            Type
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setType('direct')}
              className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all ${
                type === 'direct'
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-slate-200 hover:border-slate-300 text-slate-500'
              }`}
            >
              <Users size={20} />
              <div className="text-left">
                <p className="font-bold text-sm">Direct Message</p>
                <p className="text-[10px] opacity-70">To specific people</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setType('announcement')}
              className={`flex items-center gap-3 p-4 rounded-2xl border-2 transition-all ${
                type === 'announcement'
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-slate-200 hover:border-slate-300 text-slate-500'
              }`}
            >
              <Megaphone size={20} />
              <div className="text-left">
                <p className="font-bold text-sm">Announcement</p>
                <p className="text-[10px] opacity-70">Broadcast to group</p>
              </div>
            </button>
          </div>
        </div>

        {/* SUBJECT */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="What's this about?"
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
        </div>

        {/* RECIPIENTS (DIRECT) */}
        {type === 'direct' && (
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
              Recipients ({selectedUserIds.length} selected)
            </label>

            {/* Selected chips */}
            {selectedUserIds.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {selectedUserIds.map(uid => {
                  const r = recipients.find(r => r.user_id === uid)
                  if (!r) return null
                  return (
                    <span
                      key={uid}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold border border-blue-200"
                    >
                      {r.full_name}
                      <button
                        type="button"
                        onClick={() => toggleRecipient(uid)}
                        className="p-0.5 hover:bg-blue-200 rounded-full transition-colors"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}

            {/* Search */}
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search tenants, owners, vendors..."
                className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </div>

            {/* Recipient list */}
            <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
              {loadingRecipients ? (
                <div className="p-8 text-center">
                  <Loader2 size={20} className="animate-spin mx-auto text-slate-400" />
                </div>
              ) : Object.keys(groupedRecipients).length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm font-medium">
                  No recipients found
                </div>
              ) : (
                Object.entries(groupedRecipients).map(([role, users]) => (
                  <div key={role}>
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        {role}s ({users.length})
                      </span>
                    </div>
                    {users.map(r => (
                      <button
                        key={r.user_id}
                        type="button"
                        onClick={() => toggleRecipient(r.user_id)}
                        className={`w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 ${
                          selectedUserIds.includes(r.user_id) ? 'bg-blue-50/50' : ''
                        }`}
                      >
                        <div className="text-left">
                          <p className="text-sm font-bold text-slate-900">{r.full_name}</p>
                          {r.entity_label && (
                            <p className="text-[10px] text-slate-400 font-medium">{r.entity_label}</p>
                          )}
                        </div>
                        <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                          selectedUserIds.includes(r.user_id)
                            ? 'border-blue-500 bg-blue-500'
                            : 'border-slate-300'
                        }`}>
                          {selectedUserIds.includes(r.user_id) && (
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* PROPERTY SCOPE (ANNOUNCEMENT) */}
        {type === 'announcement' && (
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
              Property Scope (optional)
            </label>
            <div className="relative">
              <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
                className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 appearance-none bg-white"
              >
                <option value="">All Properties (Global)</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-slate-400 mt-2 font-medium">
              {propertyId
                ? 'All tenants and owners linked to this property will receive the announcement.'
                : 'All active tenants and owners will receive this announcement.'}
            </p>
          </div>
        )}

        {/* MESSAGE */}
        <div>
          <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
            Message
          </label>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Type your message..."
            rows={4}
            className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-none"
          />
        </div>

        {/* ACTIONS */}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-3 text-sm font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createConversation.isPending}
            className={`px-6 py-3 text-sm font-bold text-white rounded-xl transition-all active:scale-95 shadow-md disabled:opacity-50 ${
              type === 'announcement'
                ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-900/20'
                : 'bg-blue-600 hover:bg-blue-700 shadow-blue-900/20'
            }`}
          >
            {createConversation.isPending ? (
              <Loader2 size={18} className="animate-spin" />
            ) : type === 'announcement' ? (
              'Send Announcement'
            ) : (
              'Start Conversation'
            )}
          </button>
        </div>
      </div>
    </AccessibleModal>
  )
}
