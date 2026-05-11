'use client'

import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { 
  Send, Hash, Users, Shield, 
  Search, MessageSquare, Loader2, Circle 
} from 'lucide-react'

type Message = {
  id: string
  sender_name: string
  message_text: string
  created_at: string
}

export default function TeamChatPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [channel, setChannel] = useState('general')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Track authenticated user info for sending messages
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [currentUserName, setCurrentUserName] = useState<string>('Manager')

  // Fetch user profile on mount
  useEffect(() => {
    async function loadUser() {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        setCurrentUserId(user.id)
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', user.id)
          .single()
        if (profile?.full_name) {
          setCurrentUserName(profile.full_name)
        }
      }
    }
    loadUser()
  }, [])

  useEffect(() => {
    // Clear previous channel's messages before fetching new ones
    setMessages([])
    fetchMessages()

    // REAL-TIME SUBSCRIPTION
    const channelSub = supabase
      .channel(`team-chat-${channel}`)
      .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `channel_name=eq.${channel}`
      }, (payload) => {
        setMessages(prev => [...prev, payload.new as Message])
      })
      .subscribe()

    return () => { supabase.removeChannel(channelSub) }
  }, [channel])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function fetchMessages() {
    setLoading(true)
    const { data } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('channel_name', channel)
      .order('created_at', { ascending: true })
      .limit(50)
    
    if (data) setMessages(data)
    setLoading(false)
  }

  const sendMessage = async () => {
    if (!input.trim() || !currentUserId) return
    const currentInput = input
    setInput('')

    const { error } = await supabase.from('chat_messages').insert({
      sender_id: currentUserId,          // FK: chat_messages.sender_id → auth.users.id
      sender_name: currentUserName,      // Derived from profiles.full_name
      message_text: currentInput,
      channel_name: channel
    })

    if (error) toast.error("Message failed to send")
  }

  return (
    <div className="flex h-screen bg-white font-sans text-slate-900 overflow-hidden">
      {/* CHANNEL SIDEBAR */}
      <div className="w-64 bg-slate-900 flex flex-col shrink-0">
        <div className="p-6 border-b border-slate-800">
           <h1 className="text-white font-black italic tracking-tighter text-xl">RYLEXA<span className="text-blue-500">.TEAM</span></h1>
        </div>
        <div className="flex-1 p-4 space-y-2 overflow-y-auto">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest px-2 mb-4">Channels</p>
          {['general', 'maintenance', 'urgent', 'accounting'].map(c => (
            <button 
              key={c}
              onClick={() => setChannel(c)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-bold transition-all
                ${channel === c ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'}
              `}
            >
              <Hash size={16} /> {c}
            </button>
          ))}
        </div>
      </div>

      {/* CHAT AREA */}
      <div className="flex-1 flex flex-col">
        <header className="h-16 border-b border-slate-100 flex items-center justify-between px-8 bg-white shadow-sm">
           <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-500">
                 <Hash size={18} />
              </div>
              <h2 className="font-bold text-lg capitalize">{channel} Channel</h2>
           </div>
           <div className="flex items-center gap-2">
              <Circle size={8} className="fill-green-500 text-green-500" />
              <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">3 Managers Online</span>
           </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50/30">
          {loading ? (
            <div className="flex justify-center items-center h-full"><Loader2 className="animate-spin text-blue-500" /></div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                   <span className="font-black text-sm text-slate-900">{msg.sender_name}</span>
                   <span className="text-[10px] font-medium text-slate-400">
                      {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                   </span>
                </div>
                <div className="bg-white border border-slate-200 p-4 rounded-2xl rounded-tl-none shadow-sm max-w-2xl text-sm text-slate-700 leading-relaxed">
                   {msg.message_text}
                </div>
              </div>
            ))
          )}
          <div ref={scrollRef} />
        </div>

        <div className="p-6 bg-white border-t border-slate-100">
           <div className="flex items-center gap-4 bg-slate-100 rounded-2xl px-4 py-2 focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:bg-white transition-all border border-transparent focus-within:border-blue-500/50">
              <input 
                type="text" 
                className="flex-1 bg-transparent border-none py-3 text-sm outline-none focus:ring-0"
                placeholder={`Message #${channel}...`}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              />
              <button 
                onClick={sendMessage}
                disabled={!input.trim()}
                className="p-3 bg-slate-900 text-white rounded-xl hover:bg-blue-600 transition-all active:scale-95 shadow-md disabled:opacity-30"
              >
                 <Send size={18} />
              </button>
           </div>
        </div>
      </div>
    </div>
  )
}