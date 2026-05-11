'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MessageSquare, Plus, Search, Send, Loader2, Archive,
  BellOff, Bell, Users, Megaphone, Clock, Circle, Filter,
  AlertCircle, Phone
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import {
  useConversations,
  useConversationMessages,
  useConversationDetail,
  useSendMessage,
  useMarkAsRead,
  useArchiveConversation,
  useToggleMute,
  getTypeColor,
  getRoleColor,
  type Conversation,
  type ConversationFilters,
  type ConversationType,
} from '@/hooks/useMessages'
import ComposeMessageModal from '@/components/ComposeMessageModal'
import SMSPanel from '@/components/SMSPanel'
import { useQueryClient } from '@tanstack/react-query'

type TabFilter = 'all' | 'direct' | 'announcement' | 'sms' | 'archived'

export default function AdminMessagesPage() {
  const { isEnabled, loading: flagsLoading } = useFeatureFlags()
  const queryClient = useQueryClient()

  // State
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [messageInput, setMessageInput] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messageContainerRef = useRef<HTMLDivElement>(null)

  // Build filters from tab + search
  const filters: ConversationFilters = {
    search: searchQuery || undefined,
    type: (activeTab === 'direct' || activeTab === 'announcement') ? activeTab as ConversationType : undefined,
    is_archived: activeTab === 'archived' ? true : undefined,
  }

  // Queries
  const { data: conversations = [], isLoading: loadingConvos } = useConversations(filters)
  const { data: messages = [], isLoading: loadingMessages } = useConversationMessages(selectedId)
  const { data: conversationDetail } = useConversationDetail(selectedId)

  // Mutations
  const sendMessage = useSendMessage()
  const markAsRead = useMarkAsRead()
  const archiveConversation = useArchiveConversation()
  const toggleMute = useToggleMute()

  // Current user
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id)
    })
  }, [])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Mark as read when selecting a conversation
  useEffect(() => {
    if (selectedId) {
      markAsRead.mutate(selectedId)
    }
  }, [selectedId])

  // Realtime subscription for messages
  useEffect(() => {
    if (!selectedId) return

    const channel = supabase
      .channel(`messages-${selectedId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${selectedId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedId] })
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
        markAsRead.mutate(selectedId)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [selectedId, queryClient])

  // Realtime for conversation list updates (any new message in any conversation)
  useEffect(() => {
    if (!currentUserId) return

    const channel = supabase
      .channel('conversation-updates')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversations',
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['conversations'] })
        queryClient.invalidateQueries({ queryKey: ['unread-count'] })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [currentUserId, queryClient])

  const handleSend = async () => {
    if (!messageInput.trim() || !selectedId) return
    const text = messageInput
    setMessageInput('')
    await sendMessage.mutateAsync({ conversationId: selectedId, body: text })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleCreated = (conversationId: string) => {
    setSelectedId(conversationId)
    setActiveTab('all')
  }

  // Feature flag check
  if (flagsLoading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <Loader2 className="animate-spin text-blue-500" size={40} />
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest italic">Loading...</p>
      </div>
    )
  }

  if (!isEnabled('communications')) {
    return (
      <div className="h-screen flex flex-col items-center justify-center gap-4 bg-slate-50">
        <AlertCircle size={48} className="text-slate-300" />
        <p className="text-slate-400 font-bold text-sm">Communication Center is currently disabled.</p>
        <p className="text-slate-400 text-xs">Enable the &quot;communications&quot; feature flag in Settings.</p>
      </div>
    )
  }

  // Get participant info for detail header
  const otherParticipants = conversationDetail?.participants?.filter(p => p.user_id !== currentUserId) || []
  const myParticipation = conversationDetail?.participants?.find(p => p.user_id === currentUserId)
  const isMuted = myParticipation?.is_muted || false

  const smsEnabled = isEnabled('sms_notifications')

  const TABS: { key: TabFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'direct', label: 'Direct' },
    { key: 'announcement', label: 'Announcements' },
    ...(smsEnabled ? [{ key: 'sms' as const, label: 'SMS' }] : []),
    { key: 'archived', label: 'Archived' },
  ]

  // SMS tab — full-width panel
  if (activeTab === 'sms') {
    return (
      <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">
        <div className="flex-1 flex flex-col bg-white">
          {/* Tab strip at top for navigation back */}
          <div className="px-6 pt-6 pb-0 border-b border-slate-100">
            <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
              {TABS.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); setSelectedId(null) }}
                  className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                    activeTab === tab.key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <SMSPanel />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans text-slate-900">

      {/* LEFT — CONVERSATION LIST */}
      <div className="w-[400px] border-r border-slate-200 bg-white flex flex-col shrink-0">

        {/* Header */}
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-slate-400 font-bold text-[10px] tracking-[0.2em] uppercase">Communication Center</p>
              <h1 className="text-2xl font-black italic tracking-tighter">Messages</h1>
            </div>
            <button
              onClick={() => setComposeOpen(true)}
              className="p-3 bg-slate-900 text-white rounded-xl hover:bg-blue-600 transition-all active:scale-95 shadow-md"
              title="New Conversation"
            >
              <Plus size={18} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 rounded-xl p-1 mb-4">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setSelectedId(null) }}
                className={`flex-1 py-2 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                  activeTab === tab.key
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {loadingConvos ? (
            <div className="p-10 text-center">
              <Loader2 className="animate-spin mx-auto text-blue-500" size={24} />
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-10 text-center">
              <MessageSquare size={40} className="mx-auto text-slate-300 mb-3" />
              <p className="text-slate-400 font-bold text-sm">No conversations</p>
              <p className="text-slate-400 text-xs mt-1">Start one with the + button above</p>
            </div>
          ) : (
            conversations.map(conv => (
              <button
                key={conv.id}
                onClick={() => setSelectedId(conv.id)}
                className={`w-full text-left p-5 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                  selectedId === conv.id ? 'bg-blue-50/50 border-l-4 border-l-blue-500' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {conv.unread && (
                        <Circle size={8} className="fill-blue-500 text-blue-500 shrink-0" />
                      )}
                      <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${getTypeColor(conv.conversation_type)}`}>
                        {conv.conversation_type === 'announcement' ? 'Announce' : 'Direct'}
                      </span>
                    </div>
                    <p className={`text-sm truncate ${conv.unread ? 'font-black text-slate-900' : 'font-bold text-slate-700'}`}>
                      {conv.subject || 'No subject'}
                    </p>
                    <p className="text-xs text-slate-400 truncate mt-0.5">
                      {conv.last_message_preview || 'No messages yet'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[10px] font-bold text-slate-400">
                      {formatTimeAgo(conv.last_message_at)}
                    </p>
                    <p className="text-[10px] text-slate-300 mt-1">
                      <Users size={10} className="inline mr-1" />
                      {conv.participant_count || 0}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* RIGHT — MESSAGE THREAD */}
      <div className="flex-1 flex flex-col bg-white">
        {!selectedId ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 bg-slate-50/50">
            <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
              <MessageSquare size={28} className="text-slate-300" />
            </div>
            <p className="text-slate-400 font-bold text-sm">Select a conversation</p>
            <p className="text-slate-400 text-xs">Or start a new one</p>
          </div>
        ) : (
          <>
            {/* Conversation Header */}
            <div className="px-8 py-5 border-b border-slate-100 bg-white flex items-center justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${getTypeColor(conversationDetail?.conversation_type || 'direct')}`}>
                    {conversationDetail?.conversation_type === 'announcement' ? 'Announcement' : 'Direct'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold">
                    {otherParticipants.length + 1} participants
                  </span>
                </div>
                <h2 className="text-lg font-black text-slate-900 truncate">
                  {conversationDetail?.subject || 'No subject'}
                </h2>
                <div className="flex flex-wrap gap-1 mt-1">
                  {otherParticipants.slice(0, 5).map(p => (
                    <span
                      key={p.id}
                      className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-bold border ${getRoleColor(p.profile_role || '')}`}
                    >
                      {p.full_name}
                    </span>
                  ))}
                  {otherParticipants.length > 5 && (
                    <span className="text-[10px] text-slate-400 font-bold">
                      +{otherParticipants.length - 5} more
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => toggleMute.mutate({ conversationId: selectedId, muted: !isMuted })}
                  className={`p-2.5 rounded-xl transition-colors ${
                    isMuted ? 'bg-amber-50 text-amber-600' : 'text-slate-400 hover:bg-slate-100'
                  }`}
                  title={isMuted ? 'Unmute' : 'Mute'}
                >
                  {isMuted ? <BellOff size={18} /> : <Bell size={18} />}
                </button>
                {activeTab !== 'archived' && (
                  <button
                    onClick={() => {
                      archiveConversation.mutate(selectedId)
                      setSelectedId(null)
                    }}
                    className="p-2.5 text-slate-400 hover:bg-red-50 hover:text-red-500 rounded-xl transition-colors"
                    title="Archive"
                  >
                    <Archive size={18} />
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            <div ref={messageContainerRef} className="flex-1 overflow-y-auto p-8 space-y-4 bg-slate-50/30">
              {loadingMessages ? (
                <div className="flex justify-center items-center h-full">
                  <Loader2 className="animate-spin text-blue-500" size={24} />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex justify-center items-center h-full">
                  <p className="text-slate-400 text-sm font-medium">No messages yet. Start the conversation!</p>
                </div>
              ) : (
                messages.map(msg => {
                  const isMe = msg.sender_id === currentUserId
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-xs text-slate-700">{msg.sender_name}</span>
                        <span className="text-[10px] text-slate-400">
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className={`max-w-xl px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                        isMe
                          ? 'bg-blue-600 text-white rounded-tr-none'
                          : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'
                      }`}>
                        {msg.body}
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-6 bg-white border-t border-slate-100">
              <div className="flex items-end gap-3 bg-slate-50 rounded-2xl px-4 py-2 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:bg-white transition-all border border-transparent focus-within:border-blue-500/50">
                <textarea
                  value={messageInput}
                  onChange={e => setMessageInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                  rows={1}
                  className="flex-1 bg-transparent border-none py-3 text-sm outline-none focus:ring-0 resize-none max-h-32"
                  style={{ minHeight: '44px' }}
                />
                <button
                  onClick={handleSend}
                  disabled={!messageInput.trim() || sendMessage.isPending}
                  className="p-3 bg-slate-900 text-white rounded-xl hover:bg-blue-600 transition-all active:scale-95 shadow-md disabled:opacity-30 shrink-0 mb-1"
                >
                  {sendMessage.isPending ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <Send size={18} />
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Compose Modal */}
      <ComposeMessageModal
        isOpen={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  )
}

// ── Helper ──
function formatTimeAgo(dateStr: string): string {
  const now = new Date()
  const then = new Date(dateStr)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHrs / 24)

  if (diffMins < 1) return 'Now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHrs < 24) return `${diffHrs}h ago`
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
