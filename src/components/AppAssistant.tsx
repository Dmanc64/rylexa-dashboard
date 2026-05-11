'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { renderMarkdown } from '@/lib/renderMarkdown'
import {
  X, Send, Mic, MicOff, Loader2,
  Compass, User, Bot, ExternalLink,
  ChevronRight, Navigation, HelpCircle, Zap,
} from 'lucide-react'

// --- Types ---

type MessageType = 'navigation' | 'explanation' | 'how_to' | 'action' | 'greeting' | 'general'

interface AssistantAction {
  type: 'navigate' | 'open_modal'
  path?: string
  modalId?: string
  label: string
}

interface Message {
  role: 'user' | 'assistant'
  text: string
  type?: MessageType
  actions?: AssistantAction[]
  suggestedFollowups?: string[]
}

// --- Page name from path ---

function getPageLabel(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return 'Home'

  const labels: Record<string, string> = {
    admin: 'Admin',
    portal: 'Tenant Portal',
    'vendor-portal': 'Vendor Portal',
    'owner-portal': 'Owner Portal',
    tenants: 'Residents',
    maintenance: 'Work Orders',
    finance: 'Finance',
    vendors: 'Vendors',
    leases: 'Leases',
    documents: 'Documents',
    inspections: 'Inspections',
    compliance: 'Compliance',
    messages: 'Messages',
    chat: 'Team Chat',
    reports: 'Reports',
    owners: 'Owners',
    properties: 'Properties',
    billing: 'Billing',
    reconcile: 'Reconciliation',
    distributions: 'Distributions',
    payroll: 'Payroll',
    statements: 'Statements',
    budgets: 'Budgets',
    ap: 'Accounts Payable',
    'ar-agent': 'AR Agent',
    audit: 'AI Audit',
    analytics: 'Analytics',
    settings: 'Settings',
    'audit-log': 'Audit Trail',
    users: 'Users',
    assignments: 'Assignments',
    policies: 'Policies',
    applications: 'Applications',
    approvals: 'Approvals',
    'leasing-crm': 'Leasing CRM',
    listings: 'Listings',
    syndication: 'Syndication',
    turns: 'Unit Turns',
    evictions: 'Evictions',
    onboarding: 'Onboarding',
    'portfolio-map': 'Portfolio Map',
    scorecard: 'Scorecard',
    templates: 'Templates',
    repairs: 'Repairs',
    'log-work': 'Log Work',
    availability: 'Availability',
  }

  const breadcrumb = segments
    .map(s => labels[s] || s.charAt(0).toUpperCase() + s.slice(1))
    .join(' > ')

  return breadcrumb
}

// --- Icon for message type ---

function getMessageIcon(type?: MessageType) {
  switch (type) {
    case 'navigation':
    case 'action':
      return <Navigation size={14} />
    case 'explanation':
      return <HelpCircle size={14} />
    case 'how_to':
      return <Zap size={14} />
    default:
      return <Bot size={14} />
  }
}

function getMessageIconBg(type?: MessageType) {
  switch (type) {
    case 'navigation':
    case 'action':
      return 'bg-indigo-600'
    case 'explanation':
      return 'bg-violet-600'
    case 'how_to':
      return 'bg-amber-600'
    default:
      return 'bg-blue-600'
  }
}

// --- Component ---

type AppAssistantProps = {
  /** Override position classes for the trigger button and panel (default: 'bottom-8 right-8') */
  position?: string
}

export default function AppAssistant({ position = 'bottom-8 right-8' }: AppAssistantProps) {
  const pathname = usePathname()
  const router = useRouter()

  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [hasGreeted, setHasGreeted] = useState(false)

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

  // Auto-scroll to bottom
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isOpen])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen])

  // Ctrl+K / Cmd+K keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsOpen(prev => {
          const willOpen = !prev
          if (willOpen && !hasGreeted) {
            setHasGreeted(true)
            // Defer greeting to after state update
            setTimeout(() => sendMessage('hi', true), 50)
          }
          return willOpen
        })
      }
      // Escape to close
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, hasGreeted])

  // Send greeting on first open
  const handleOpen = useCallback(() => {
    setIsOpen(true)
    if (!hasGreeted) {
      setHasGreeted(true)
      // Send a greeting to get role-aware welcome
      sendMessage('hi', true)
    }
  }, [hasGreeted])

  const toggleListening = () => {
    if (isListening) {
      recognition?.stop()
      setIsListening(false)
    } else {
      recognition?.start()
      setIsListening(true)
    }
  }

  const sendMessage = useCallback(async (textOverride?: string, isAutoGreeting = false) => {
    const finalQuery = textOverride || inputRef.current?.value.trim() || ''
    if (!finalQuery) return

    if (sendingRef.current) return
    sendingRef.current = true

    // Don't show user bubble for auto-greeting
    if (!isAutoGreeting) {
      setMessages(prev => [...prev, { role: 'user', text: finalQuery }])
    }
    setInput('')
    setIsTyping(true)

    try {
      const { data, error } = await supabase.functions.invoke('app-assistant', {
        body: {
          message: finalQuery,
          currentPath: pathname,
          history: messages.slice(-8).map(m => ({ role: m.role, text: m.text })),
        },
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

        console.warn('App assistant error:', errorMessage)
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
          actions: data.actions,
          suggestedFollowups: data.suggestedFollowups,
        }])
      }
    } catch (err: any) {
      console.warn('App assistant connection error:', err?.message)
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: "I'm having trouble connecting. Please check your connection.",
      }])
    } finally {
      setIsTyping(false)
      sendingRef.current = false
    }
  }, [pathname, messages])

  const handleAction = (action: AssistantAction) => {
    if (action.type === 'navigate' && action.path) {
      router.push(action.path)
      // If there's also a modal to open, dispatch after navigation
      if (action.modalId) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('app-assistant:open-modal', {
            detail: { modalId: action.modalId },
          }))
        }, 500) // Give time for the page to load
      }
    } else if (action.type === 'open_modal' && action.modalId) {
      window.dispatchEvent(new CustomEvent('app-assistant:open-modal', {
        detail: { modalId: action.modalId },
      }))
    }
  }

  const handleSuggestionClick = (query: string) => {
    setInput(query)
    sendMessage(query)
  }

  // Get the last assistant message's suggested followups
  const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant')
  const showFollowups = lastAssistantMsg?.suggestedFollowups && !isTyping

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={handleOpen}
        className={`fixed ${position} z-50 flex items-center gap-2 px-4 py-3 rounded-2xl shadow-2xl transition-all duration-300 hover:scale-105 active:scale-95
          ${isOpen ? 'scale-0 opacity-0' : 'scale-100 opacity-100'}
          bg-indigo-600 text-white border border-indigo-500 hover:bg-indigo-500
        `}
        title="Navigation Assistant (Ctrl+K)"
      >
        <Compass className="w-5 h-5" />
        <kbd className="hidden md:inline text-[10px] font-mono bg-indigo-500/50 px-1.5 py-0.5 rounded-md border border-indigo-400/30">
          {typeof navigator !== 'undefined' && /Mac/.test(navigator.userAgent) ? '⌘K' : 'Ctrl+K'}
        </kbd>
      </button>

      {/* Chat panel */}
      <div className={`fixed ${position} z-50 w-full max-w-[420px] bg-white rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2)] border border-slate-200 overflow-hidden transition-all duration-500 origin-bottom-right
        ${isOpen ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-10 opacity-0 scale-95 pointer-events-none'}
      `}>
        {/* HEADER */}
        <div className="bg-slate-900 p-5 flex justify-between items-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-500"></div>
          <div className="flex items-center gap-3 relative z-10">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg">
              <Compass className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-white font-bold text-sm tracking-tight">Rylexa Navigator</h3>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${isListening ? 'bg-red-500 animate-ping' : 'bg-green-500'}`}></span>
                <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                  {isListening ? 'Listening...' : isTyping ? 'Thinking...' : getPageLabel(pathname)}
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
            <div key={i}>
              <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex gap-2.5 max-w-[88%] ${m.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
                    ${m.role === 'user' ? 'bg-slate-200 text-slate-600' : `${getMessageIconBg(m.type)} text-white`}
                  `}>
                    {m.role === 'user' ? <User size={13} /> : getMessageIcon(m.type)}
                  </div>
                  <div className={`p-3.5 rounded-2xl text-[13px] leading-relaxed shadow-sm border
                    ${m.role === 'user'
                      ? 'bg-slate-900 text-white rounded-tr-none border-slate-800'
                      : 'bg-white border-slate-200 text-slate-700 rounded-tl-none'}
                  `}>
                    {m.role === 'assistant' ? (
                      <div className="space-y-0">{renderMarkdown(m.text)}</div>
                    ) : (
                      m.text
                    )}
                  </div>
                </div>
              </div>

              {/* Navigation action buttons */}
              {m.role === 'assistant' && m.actions && m.actions.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2 ml-10">
                  {m.actions.map((action, j) => (
                    <button
                      key={j}
                      onClick={() => handleAction(action)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium hover:bg-indigo-100 hover:border-indigo-300 transition-all group"
                    >
                      <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      {action.label}
                      <ChevronRight className="w-3 h-3 opacity-50" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="flex justify-start gap-2.5">
              <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center">
                <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
              </div>
              <div className="bg-white border border-slate-200 p-3.5 rounded-2xl rounded-tl-none shadow-sm flex gap-1">
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
              </div>
            </div>
          )}

          {/* Suggested follow-ups */}
          {showFollowups && (
            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-1">Suggested</p>
              <div className="flex flex-wrap gap-1.5">
                {lastAssistantMsg!.suggestedFollowups!.map((sq, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(sq)}
                    className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-indigo-50 hover:border-indigo-200 transition-all text-xs font-medium text-slate-600 hover:text-indigo-700"
                  >
                    {sq}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Empty state — shown before greeting response arrives */}
          {messages.length === 0 && !isTyping && (
            <div className="flex flex-col items-center justify-center h-full text-center px-6">
              <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mb-4">
                <Compass className="w-8 h-8 text-indigo-600" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm mb-1">Rylexa Navigator</h4>
              <p className="text-slate-500 text-xs leading-relaxed">
                Ask me to find pages, explain features, or guide you through tasks.
              </p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* INPUT */}
        <div className="p-3.5 bg-white border-t border-slate-100">
          <div className={`flex items-center gap-2 rounded-2xl px-2 py-1 transition-all border
            ${isListening
              ? 'bg-red-50 border-red-200 ring-2 ring-red-100'
              : 'bg-slate-100 border-transparent focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500/50'}
          `}>
            {recognition && (
              <button
                onClick={toggleListening}
                className={`p-2 rounded-xl transition-colors ${isListening ? 'bg-red-500 text-white' : 'text-slate-400 hover:text-indigo-600'}`}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            )}
            <input
              ref={inputRef}
              className="flex-1 bg-transparent border-none py-3 text-sm font-medium text-slate-800 focus:ring-0 outline-none placeholder:text-slate-400"
              placeholder={isListening ? "I'm listening..." : 'Ask me anything...'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isTyping && !e.repeat) {
                  e.preventDefault()
                  sendMessage()
                }
              }}
            />
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || isTyping}
              className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-500 disabled:opacity-30 transition-all shadow-md active:scale-90"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
