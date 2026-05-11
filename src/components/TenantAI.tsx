'use client'

import { useState, useRef, useEffect, useCallback, type ReactElement } from 'react'
import { supabase } from '@/lib/supabaseClient'
import {
  X, Send, Mic, MicOff, Loader2,
  Sparkles, User, Bot, Wrench, DollarSign,
  FileText, Shield, HelpCircle, ChevronRight
} from 'lucide-react'

type Props = {
  tenantId?: string
  unitId?: string
}

type MessageType =
  | 'greeting' | 'maintenance_created' | 'maintenance_exists'
  | 'maintenance_status' | 'balance_inquiry' | 'payment_history'
  | 'lease_info' | 'rent_info' | 'policy_info' | 'general' | 'referral'

type Message = {
  role: 'user' | 'assistant'
  text: string
  type?: MessageType
  action?: { type: string; ticket_id?: string }
}

const SUGGESTED_QUESTIONS = [
  { label: 'Check Balance', query: 'What is my current balance?', icon: DollarSign },
  { label: 'Rent Due Date', query: 'When is my rent due?', icon: FileText },
  { label: 'Repair Status', query: "What's the status of my maintenance requests?", icon: Wrench },
  { label: 'Pet Policy', query: 'What is the pet policy?', icon: Shield },
]

// Simple markdown renderer — handles bold, bullets, blockquotes, and headings
function renderMarkdown(text: string) {
  const lines = text.split('\n')
  const elements: ReactElement[] = []
  let blockquote: string[] = []

  const flushBlockquote = () => {
    if (blockquote.length > 0) {
      elements.push(
        <blockquote key={`bq-${elements.length}`} className="border-l-3 border-blue-400 pl-3 my-2 text-slate-600 italic text-xs leading-relaxed">
          {blockquote.map((l, i) => <span key={i}>{formatInline(l)}{i < blockquote.length - 1 && <br />}</span>)}
        </blockquote>
      )
      blockquote = []
    }
  }

  const formatInline = (line: string) => {
    // Bold: **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g)
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>
      }
      return <span key={i}>{part}</span>
    })
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Blockquote
    if (line.startsWith('> ')) {
      blockquote.push(line.slice(2))
      continue
    }
    flushBlockquote()

    // Empty line
    if (!line.trim()) {
      elements.push(<div key={`br-${i}`} className="h-2" />)
      continue
    }

    // Heading ###
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="font-semibold text-slate-800 text-xs mt-2 mb-0.5">{formatInline(line.slice(4))}</h4>)
      continue
    }

    // Bullet point
    if (line.match(/^[\u2022\-\*]\s/)) {
      const content = line.replace(/^[\u2022\-\*]\s/, '')
      elements.push(
        <div key={i} className="flex gap-1.5 ml-1 my-0.5">
          <span className="text-blue-500 mt-0.5 shrink-0">&bull;</span>
          <span>{formatInline(content)}</span>
        </div>
      )
      continue
    }

    // Regular paragraph
    elements.push(<p key={i} className="my-0.5">{formatInline(line)}</p>)
  }

  flushBlockquote()
  return elements
}

// Message icon based on response type
function getMessageIcon(type?: MessageType) {
  switch (type) {
    case 'maintenance_created':
    case 'maintenance_exists':
    case 'maintenance_status':
      return <Wrench size={14} />
    case 'balance_inquiry':
    case 'payment_history':
    case 'rent_info':
      return <DollarSign size={14} />
    case 'lease_info':
      return <FileText size={14} />
    case 'policy_info':
      return <Shield size={14} />
    default:
      return <Bot size={14} />
  }
}

function getMessageIconBg(type?: MessageType) {
  switch (type) {
    case 'maintenance_created':
    case 'maintenance_exists':
      return 'bg-green-600'
    case 'maintenance_status':
      return 'bg-amber-600'
    case 'balance_inquiry':
    case 'payment_history':
    case 'rent_info':
      return 'bg-emerald-600'
    case 'lease_info':
      return 'bg-indigo-600'
    case 'policy_info':
      return 'bg-purple-600'
    default:
      return 'bg-blue-600'
  }
}

function getMessageBubbleStyle(type?: MessageType) {
  switch (type) {
    case 'maintenance_created':
    case 'maintenance_exists':
      return 'bg-green-50 border-green-100 text-green-900'
    default:
      return 'bg-white border-slate-200 text-slate-700'
  }
}

export default function TenantAI({ tenantId, unitId }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      text: "Hello! I'm your Rylexa AI Assistant. I can help you with lease questions, balance inquiries, maintenance requests, and property policies.\n\nHow can I help you today?",
      type: 'greeting',
    }
  ])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sendingRef = useRef(false)

  // Web Speech API
  const [recognition, setRecognition] = useState<any>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      if (SpeechRecognition) {
        const rec = new SpeechRecognition()
        rec.continuous = false
        rec.interimResults = false
        rec.lang = 'en-US'
        rec.onresult = (event: any) => {
          const transcript = event.results[0][0].transcript
          setInput(transcript)
          setIsListening(false)
        }
        rec.onerror = () => setIsListening(false)
        rec.onend = () => setIsListening(false)
        setRecognition(rec)
      }
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  const toggleListening = () => {
    if (isListening) {
      recognition?.stop()
      setIsListening(false)
    } else {
      recognition?.start()
      setIsListening(true)
    }
  }

  const handleSend = useCallback(async (textOverride?: string) => {
    const finalQuery = textOverride || inputRef.current?.value.trim() || ''
    if (!finalQuery) return

    if (sendingRef.current) return
    sendingRef.current = true

    setMessages(prev => [...prev, { role: 'user', text: finalQuery }])
    setInput('')
    setIsTyping(true)
    setShowSuggestions(false)

    try {
      const { data, error } = await supabase.functions.invoke('tenant-assistant', {
        body: { tenant_id: tenantId, unit_id: unitId, message: finalQuery },
      })

      if (error) {
        let errorMessage = error.message
        try {
          const ctx = (error as any)?.context
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json()
            errorMessage = body?.error || errorMessage
          }
        } catch { /* ignore */ }

        console.warn('AI assistant error:', errorMessage)
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: errorMessage.includes('Authorization') || errorMessage.includes('token')
            ? 'Your session has expired. Please refresh the page and log in again.'
            : "I'm having trouble right now. Please try again in a moment.",
        }])
        return
      }

      if (data) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: data.reply,
          type: data.type as MessageType,
          action: data.action,
        }])
      }
    } catch (err: any) {
      console.warn('AI connection error:', err?.message)
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: "I'm having trouble connecting. Please check your connection.",
      }])
    } finally {
      setIsTyping(false)
      sendingRef.current = false
    }
  }, [tenantId, unitId])

  const handleSuggestionClick = (query: string) => {
    setInput(query)
    handleSend(query)
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-8 right-8 z-50 p-4 rounded-2xl shadow-2xl transition-all duration-300 hover:scale-110 active:scale-95
          ${isOpen ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}
          bg-slate-900 text-white border border-slate-700
        `}
      >
        <Sparkles className="w-6 h-6 text-blue-400" />
      </button>

      {/* Chat panel */}
      <div className={`fixed bottom-8 right-8 z-50 w-full max-w-[420px] bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-slate-200 overflow-hidden transition-all duration-500 origin-bottom-right
        ${isOpen ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-10 opacity-0 scale-95 pointer-events-none'}
      `}>
        {/* HEADER */}
        <div className="bg-slate-900 p-5 flex justify-between items-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500"></div>
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm tracking-tight">Rylexa AI Assistant</h3>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-red-500 animate-ping' : 'bg-green-500'}`}></span>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                  {isListening ? 'Listening...' : isTyping ? 'Thinking...' : 'Online'}
                </span>
              </div>
            </div>
          </div>
          <button onClick={() => setIsOpen(false)} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* MESSAGES */}
        <div className="h-[450px] overflow-y-auto p-4 space-y-4 bg-slate-50/50">
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex gap-2.5 max-w-[88%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
                  ${m.role === 'user' ? 'bg-slate-200 text-slate-600' : `${getMessageIconBg(m.type)} text-white`}
                `}>
                  {m.role === 'user' ? <User size={13} /> : getMessageIcon(m.type)}
                </div>
                <div className={`p-3.5 rounded-2xl text-[13px] leading-relaxed shadow-sm border
                  ${m.role === 'user'
                    ? 'bg-slate-900 text-white rounded-tr-none border-slate-800'
                    : `${getMessageBubbleStyle(m.type)} rounded-tl-none`}
                `}>
                  {m.role === 'assistant' ? (
                    <div className="space-y-0">{renderMarkdown(m.text)}</div>
                  ) : (
                    m.text
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="flex justify-start gap-2.5">
              <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
                <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
              </div>
              <div className="bg-white border border-slate-200 p-3.5 rounded-2xl rounded-tl-none shadow-sm flex gap-1">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce"></span>
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
              </div>
            </div>
          )}

          {/* Suggested questions */}
          {showSuggestions && messages.length <= 1 && !isTyping && (
            <div className="space-y-2 pt-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Quick Questions</p>
              <div className="grid grid-cols-2 gap-2">
                {SUGGESTED_QUESTIONS.map((sq) => (
                  <button
                    key={sq.label}
                    onClick={() => handleSuggestionClick(sq.query)}
                    className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-200 transition-all text-left group"
                  >
                    <sq.icon className="w-4 h-4 text-slate-400 group-hover:text-blue-500 shrink-0" />
                    <span className="text-xs font-medium text-slate-600 group-hover:text-blue-700">{sq.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* INPUT */}
        <div className="p-3.5 bg-white border-t border-slate-100">
          <div className={`flex items-center gap-2 rounded-2xl px-2 py-1 transition-all border
            ${isListening
              ? 'bg-red-50 border-red-200 ring-2 ring-red-100'
              : 'bg-slate-100 border-transparent focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-500/50'}
          `}>
            <button
              onClick={toggleListening}
              className={`p-2 rounded-xl transition-colors ${isListening ? 'bg-red-500 text-white' : 'text-slate-400 hover:text-blue-600'}`}
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <input
              ref={inputRef}
              className="flex-1 bg-transparent border-none py-3 text-sm font-medium text-slate-800 focus:ring-0 outline-none placeholder:text-slate-400"
              placeholder={isListening ? "I'm listening..." : 'Ask me anything...'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isTyping && !e.repeat) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || isTyping}
              className="p-2 bg-slate-900 text-white rounded-xl hover:bg-blue-600 disabled:opacity-30 transition-all shadow-md active:scale-90"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
