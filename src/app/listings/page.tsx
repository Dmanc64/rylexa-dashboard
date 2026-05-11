'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'
import {
  Home, MapPin, Calendar, Sparkles,
  MessageCircle, ArrowRight, BedDouble, Bath,
  Loader2, CheckCircle2, Building2, Send, User, Mail, Phone
} from 'lucide-react'

export default function PublicListingsPage() {
  const [units, setUnits] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showAgent, setShowAgent] = useState(false)
  const [messages, setMessages] = useState([{ role: 'bot', text: 'Hi! I am the Rylexa Leasing Agent. Which of our properties are you interested in?' }])
  const [input, setInput] = useState('')
  const [leadForm, setLeadForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    interested_unit_id: '',
    desired_move_in: '',
    message: '',
  })
  const [submittingLead, setSubmittingLead] = useState(false)
  const [leadSubmitted, setLeadSubmitted] = useState(false)

  useEffect(() => {
    async function fetchAvailable() {
      const { data } = await supabase
        .from('units')
        .select('*, properties(name, city), unit_listings(id, title, description, rent_amount, photos, amenities)')
        .eq('status', 'Vacant')
      if (data) setUnits(data)
      setLoading(false)
    }
    fetchAvailable()
  }, [])

  const handleChat = async () => {
    if (!input.trim()) return
    const userMsg = input
    setMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setInput('')

    // Simulating AI Qualfication Logic
    setTimeout(() => {
        let reply = "That unit is available! Would you like to schedule a tour for this Wednesday at 2:00 PM?"
        if (userMsg.toLowerCase().includes('dog') || userMsg.toLowerCase().includes('cat')) {
            reply = "We are pet friendly! There is a one-time $300 pet fee. Would you like to proceed with an application?"
        }
        setMessages(prev => [...prev, { role: 'bot', text: reply }])
    }, 800)
  }

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingLead(true)
    try {
      const { error } = await supabase.from('leads').insert({
        first_name: leadForm.first_name,
        last_name: leadForm.last_name,
        email: leadForm.email,
        phone: leadForm.phone || null,
        source: 'website',
        interested_unit_id: leadForm.interested_unit_id || null,
        notes: leadForm.message || null,
      })
      if (error) throw error
      setLeadSubmitted(true)
      toast.success('Application received! We will contact you shortly.')
    } catch (err: any) {
      toast.error(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmittingLead(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      {/* PUBLIC NAVBAR */}
      <nav className="bg-white border-b border-slate-200 px-8 py-4 flex justify-between items-center sticky top-0 z-40">
        <h1 className="text-2xl font-black italic tracking-tighter">RYLEXA<span className="text-blue-600">.LIVING</span></h1>
        <div className="flex gap-6 text-sm font-bold text-slate-500">
          <button className="hover:text-blue-600">Reno</button>
          <button className="hover:text-blue-600">Las Vegas</button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-8 lg:p-12">
        <div className="mb-12">
          <h2 className="text-4xl font-black tracking-tight text-slate-900 mb-2">Available Units</h2>
          <p className="text-slate-500 font-medium">Find your next home in Nevada's premier communities.</p>
        </div>

        {/* LISTINGS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {loading ? (
            <div className="col-span-full py-20 flex justify-center"><Loader2 className="animate-spin text-blue-600" /></div>
          ) : units.map(unit => {
            const listing = unit.unit_listings?.[0]
            const rentDisplay = listing?.rent_amount || unit.market_rent || unit.rent_amount
            const beds = unit.bedroom_count
            const baths = unit.bathrooms
            return (
            <div key={unit.id} className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-xl transition-all group">
              <div className="h-56 bg-slate-200 relative overflow-hidden">
                 <div className="absolute inset-0 bg-slate-900/20 group-hover:bg-slate-900/0 transition-colors"></div>
                 <div className="absolute top-4 left-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest text-blue-600">
                    {unit.properties?.city ?? ''}
                 </div>
              </div>
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold">{listing?.title || unit.properties.name}</h3>
                    <p className="text-slate-400 text-sm font-bold uppercase tracking-tighter">Unit {unit.name}</p>
                  </div>
                  {rentDisplay && <div className="text-2xl font-black text-blue-600">${Number(rentDisplay).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
                </div>

                <div className="flex gap-4 mb-6 border-y border-slate-50 py-4">
                   <div className="flex items-center gap-1.5 text-slate-500 text-sm font-bold">
                      <BedDouble size={18} /> {beds ?? '—'} Bed
                   </div>
                   <div className="flex items-center gap-1.5 text-slate-500 text-sm font-bold">
                      <Bath size={18} /> {baths ?? '—'} Bath
                   </div>
                   {unit.sqft && (
                     <div className="flex items-center gap-1.5 text-slate-500 text-sm font-bold">
                       {unit.sqft.toLocaleString()} sqft
                     </div>
                   )}
                </div>

                <button
                  onClick={() => setShowAgent(true)}
                  className="w-full py-4 bg-slate-900 text-white font-bold rounded-2xl flex items-center justify-center gap-2 group hover:bg-blue-600 transition-colors"
                >
                  <Sparkles size={18} /> Ask AI Agent
                </button>
              </div>
            </div>
            )
          })}
        </div>

        {/* LEAD CAPTURE SECTION */}
        <div className="mt-16 mb-8">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-900 p-8">
              <h3 className="text-2xl font-black italic uppercase tracking-tight text-white">Interested? Get in Touch</h3>
              <p className="text-slate-400 text-sm font-medium mt-1">Fill out the form below and our leasing team will reach out within 24 hours.</p>
            </div>

            {leadSubmitted ? (
              <div className="p-12 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4">
                  <CheckCircle2 size={32} className="text-green-600" />
                </div>
                <h4 className="text-xl font-bold text-slate-900 mb-2">Thank You!</h4>
                <p className="text-slate-500 font-medium max-w-md">Your inquiry has been received. A member of our leasing team will contact you shortly.</p>
              </div>
            ) : (
              <form onSubmit={handleLeadSubmit} className="p-8 space-y-6">
                {/* First Name + Last Name */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">First Name *</label>
                    <div className="relative">
                      <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={leadForm.first_name}
                        onChange={(e) => setLeadForm(prev => ({ ...prev, first_name: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Jane"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Last Name *</label>
                    <div className="relative">
                      <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        required
                        value={leadForm.last_name}
                        onChange={(e) => setLeadForm(prev => ({ ...prev, last_name: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Doe"
                      />
                    </div>
                  </div>
                </div>

                {/* Email + Phone */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Email *</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        required
                        value={leadForm.email}
                        onChange={(e) => setLeadForm(prev => ({ ...prev, email: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="jane@email.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Phone</label>
                    <div className="relative">
                      <Phone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="tel"
                        value={leadForm.phone}
                        onChange={(e) => setLeadForm(prev => ({ ...prev, phone: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="(555) 123-4567"
                      />
                    </div>
                  </div>
                </div>

                {/* Interested Unit + Desired Move-in */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Interested Unit</label>
                    <select
                      value={leadForm.interested_unit_id}
                      onChange={(e) => setLeadForm(prev => ({ ...prev, interested_unit_id: e.target.value }))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent appearance-none"
                    >
                      <option value="">Select a unit...</option>
                      {units.map(unit => {
                        const listing = unit.unit_listings?.[0]
                        const rent = listing?.rent_amount || unit.market_rent || unit.rent_amount
                        return (
                          <option key={unit.id} value={unit.id}>
                            {unit.properties?.name} — Unit {unit.name}{rent ? ` ($${Number(rent).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mo)` : ''}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Desired Move-in Date</label>
                    <div className="relative">
                      <Calendar size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="date"
                        value={leadForm.desired_move_in}
                        onChange={(e) => setLeadForm(prev => ({ ...prev, desired_move_in: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 pl-11 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>

                {/* Message */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Message</label>
                  <textarea
                    value={leadForm.message}
                    onChange={(e) => setLeadForm(prev => ({ ...prev, message: e.target.value }))}
                    rows={4}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-3 px-4 text-sm font-medium outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                    placeholder="Tell us about what you're looking for..."
                  />
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={submittingLead}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-2xl flex items-center justify-center gap-2 transition-colors"
                >
                  {submittingLead ? (
                    <><Loader2 size={18} className="animate-spin" /> Submitting...</>
                  ) : (
                    <><Send size={18} /> Submit Inquiry</>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>

      {/* FLOATING LEASING AGENT UI */}
      {showAgent && (
        <div className="fixed bottom-8 right-8 w-full max-w-md bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden z-50 flex flex-col h-[600px]">
          <div className="bg-slate-900 p-6 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white">
                <Building2 size={24} />
              </div>
              <div>
                <h4 className="text-white font-bold text-sm">Leasing Assistant</h4>
                <p className="text-blue-400 text-[10px] font-bold uppercase tracking-widest animate-pulse">Online & Ready</p>
              </div>
            </div>
            <button onClick={() => setShowAgent(false)} className="text-slate-400 hover:text-white">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] p-4 rounded-2xl text-sm font-medium shadow-sm ${
                  m.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none'
                }`}>
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 bg-white border-t border-slate-100 flex gap-2">
            <input 
              className="flex-1 bg-slate-100 p-3 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500" 
              placeholder="Ask about pets, utilities..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleChat()}
            />
            <button onClick={handleChat} className="p-3 bg-slate-900 text-white rounded-xl active:scale-90">
              <ArrowRight size={20} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}