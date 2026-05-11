'use client'

import { useState, useEffect, useRef } from 'react'
import {
  MessageSquare, Send, Loader2, Circle
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import {
  useConversations,
  useConversationMessages,
  useConversationDetail,
  useSendMessage,
  useMarkAsRead,
  getTypeColor,
  getRoleColor,
  type ConversationFilters,
} from '@/hooks/useMessages'
import { useQueryClient } from '@tanstack/react-query'

export default function TenantMessagesPage() {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messageInput, setMessageInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id)
    })
  }, [])

  const filters: ConversationFilters = { is_archived: false }
  const { data: conversations = [], isLoading: loadingConvos } = useConversations(filters)
  const { data: messages = [], isLoading: loadingMessages } = useConversationMessages(selectedId)
  const { data: conversationDetail } = useConversationDetail(selectedId)

  const sendMessage = useSendMessage()
  const markAsRead = useMarkAsRead()

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Mark as read
  useEffect(() => {
    if (selectedId) markAsRead.mutate(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Realtime
  useEffect(() => {
    if (!selectedId) return
    const channel = supabase
      .channel(`portal-messages-${selectedId}`)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, queryClient])

  const handleSend = async () => {
    if (!messageInput.trim() || !selectedId) return
    const text = messageInput
    setMessageInput('')
    try {
      await sendMessage.mutateAsync({ conversationId: selectedId, body: text })
    } catch (err: any) {
      setMessageInput(text) // Restore input on failure
      toast.error(err?.message || 'Failed to send message')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const otherParticipants = conversationDetail?.participants?.filter(p => p.user_id !== currentUserId) || []

  return (
    <div className="max-w-6xl mx-auto p-6 md:p-10">

      {/* HEADER */}
      <div className="mb-8">
        <h1 className="text-3xl font-black tracking-tight">My Messages</h1>
        <p className="text-slate-500 font-medium text-sm">Conversations with your property management team.</p>
      </div>

      {/* TWO-COLUMN LAYOUT */}
      <div className="flex bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm" style={{ height: 'calc(100vh - 260px)' }}>

          {/* LEFT — CONVERSATION LIST */}
          <div className="w-80 border-r border-slate-200 flex flex-col shrink-0">
            <div className="p-4 border-b border-slate-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {conversations.length} Conversation{conversations.length !== 1 ? 's' : ''}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {loadingConvos ? (
                <div className="p-10 text-center">
                  <Loader2 className="animate-spin mx-auto text-blue-500" size={24} />
                </div>
              ) : conversations.length === 0 ? (
                <div className="p-10 text-center">
                  <MessageSquare size={32} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-slate-400 font-bold text-sm">No messages yet</p>
                </div>
              ) : (
                conversations.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => setSelectedId(conv.id)}
                    className={`w-full text-left p-4 border-b border-slate-50 hover:bg-slate-50 transition-colors ${
                      selectedId === conv.id ? 'bg-blue-50/50 border-l-4 border-l-blue-500' : ''
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          {conv.unread && <Circle size={7} className="fill-blue-500 text-blue-500 shrink-0" />}
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider border ${getTypeColor(conv.conversation_type)}`}>
                            {conv.conversation_type === 'announcement' ? 'Announce' : 'Direct'}
                          </span>
                        </div>
                        <p className={`text-sm truncate ${conv.unread ? 'font-black' : 'font-bold text-slate-700'}`}>
                          {conv.subject || 'No subject'}
                        </p>
                        <p className="text-xs text-slate-400 truncate mt-0.5">
                          {conv.last_message_preview || 'No messages'}
                        </p>
                      </div>
                      <span className="text-[10px] text-slate-400 font-bold shrink-0">
                        {formatTimeAgo(conv.last_message_at)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* RIGHT — MESSAGE THREAD */}
          <div className="flex-1 flex flex-col">
            {!selectedId ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-3">
                <MessageSquare size={32} className="text-slate-300" />
                <p className="text-slate-400 font-bold text-sm">Select a conversation</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 bg-white">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border ${getTypeColor(conversationDetail?.conversation_type || 'direct')}`}>
                      {conversationDetail?.conversation_type === 'announcement' ? 'Announcement' : 'Direct'}
                    </span>
                  </div>
                  <h2 className="text-lg font-black">{conversationDetail?.subject || 'No subject'}</h2>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {otherParticipants.slice(0, 4).map(p => (
                      <span key={p.id} className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-bold border ${getRoleColor(p.profile_role || '')}`}>
                        {p.full_name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30">
                  {loadingMessages ? (
                    <div className="flex justify-center items-center h-full">
                      <Loader2 className="animate-spin text-blue-500" size={24} />
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
                          <div className={`max-w-md px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
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

                {/* Input */}
                <div className="p-4 bg-white border-t border-slate-100">
                  <div className="flex items-end gap-3 bg-slate-50 rounded-2xl px-4 py-2 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:bg-white transition-all border border-transparent focus-within:border-blue-500/50">
                    <textarea
                      value={messageInput}
                      onChange={e => setMessageInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Type a reply..."
                      rows={1}
                      className="flex-1 bg-transparent border-none py-3 text-sm outline-none focus:ring-0 resize-none"
                      style={{ minHeight: '44px' }}
                    />
                    <button
                      onClick={handleSend}
                      disabled={!messageInput.trim() || sendMessage.isPending}
                      className="p-3 bg-slate-900 text-white rounded-xl hover:bg-blue-600 transition-all active:scale-95 shadow-md disabled:opacity-30 shrink-0 mb-1"
                    >
                      <Send size={18} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
  )
}

function formatTimeAgo(dateStr: string): string {
  const now = new Date()
  const then = new Date(dateStr)
  const diffMs = now.getTime() - then.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHrs = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHrs / 24)

  if (diffMins < 1) return 'Now'
  if (diffMins < 60) return `${diffMins}m`
  if (diffHrs < 24) return `${diffHrs}h`
  if (diffDays < 7) return `${diffDays}d`
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
