'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { 
  Send, Megaphone, Users, History, 
  MessageSquare, Loader2, CheckCircle2, ShieldAlert 
} from 'lucide-react'

export default function BroadcastPage() {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [target, setTarget] = useState('all') // all, reno, vegas

  const handleBroadcast = async () => {
    setSending(true)
    
    // Log the broadcast as a system event which triggers the Edge Function
    const { error } = await supabase.from('system_activity').insert({
      event_type: 'SYSTEM',
      title: 'Global Announcement',
      description: message,
      actor_name: 'Property Manager'
    })

    if (!error) {
      setMessage('')
      toast.success("Broadcast initiated. Tenants will receive notifications shortly.")
    }
    setSending(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
      <div className="max-w-3xl mx-auto space-y-8">
        
        <header className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black tracking-tight italic">Resident Broadcast</h1>
            <p className="text-slate-500 font-medium uppercase text-xs tracking-widest mt-1">Direct SMS & Email Communication</p>
          </div>
          <div className="flex items-center gap-2 text-[10px] font-black uppercase text-orange-600 bg-orange-50 px-3 py-1.5 rounded-full">
            <Megaphone size={14} /> High Priority Channel
          </div>
        </header>

        <div className="bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden">
          <div className="p-8 space-y-6">
            <div className="flex gap-4">
               {['all', 'reno', 'vegas'].map((t) => (
                 <button 
                  key={t}
                  onClick={() => setTarget(t)}
                  className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest border transition-all
                    ${target === t ? 'bg-slate-900 text-white border-slate-900 shadow-lg' : 'bg-white text-slate-400 border-slate-100 hover:border-slate-300'}
                  `}
                 >
                   {t}
                 </button>
               ))}
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase text-slate-400 tracking-widest ml-1">Message Content</label>
              <textarea 
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Ex: Urgent water shutoff scheduled for tomorrow at 9 AM..."
                className="w-full p-6 bg-slate-50 border border-slate-200 rounded-3xl focus:ring-2 focus:ring-blue-600 outline-none font-medium transition-all resize-none"
              />
            </div>

            <div className="p-6 bg-blue-50 border border-blue-100 rounded-2xl flex gap-4">
              <ShieldAlert className="text-blue-600 shrink-0" />
              <p className="text-xs text-blue-900 font-medium leading-relaxed">
                By clicking send, you are dispatching a broadcast to <strong>42 active residents</strong> in your portfolio. This action cannot be undone.
              </p>
            </div>

            <button 
              onClick={handleBroadcast}
              disabled={sending || !message.trim()}
              className="w-full py-5 bg-slate-900 text-white font-black rounded-3xl shadow-xl hover:bg-blue-600 transition-all flex items-center justify-center gap-2 disabled:opacity-30"
            >
              {sending ? <Loader2 className="animate-spin" /> : <Send size={20} />}
              DISPATCH ANNOUNCEMENT
            </button>
          </div>
        </div>

        {/* LOG OF RECENT BROADCASTS */}
        <div className="space-y-4">
           <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 ml-2">
             <History size={16} /> Broadcast History
           </h3>
           <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex justify-between items-center italic text-slate-400 text-sm">
              No global broadcasts sent in the last 30 days.
           </div>
        </div>
      </div>
    </div>
  )
}