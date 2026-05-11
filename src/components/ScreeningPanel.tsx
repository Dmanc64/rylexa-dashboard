'use client'

import { useState } from 'react'
import { Loader2, Shield, ShieldCheck, ShieldAlert, ShieldX, RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import type { Application } from '@/hooks/useApplications'

type ScreeningBreakdown = {
  categories: { name: string; score: number; max: number }[]
  total_income: number
  credit_score: number | null
}

interface ScreeningPanelProps {
  application: Application
  onScored: () => void
}

export default function ScreeningPanel({ application, onScored }: ScreeningPanelProps) {
  const [scoring, setScoring] = useState(false)
  const [saving, setSaving] = useState(false)
  const [breakdown, setBreakdown] = useState<ScreeningBreakdown | null>(null)

  // Local form state for manual entry
  const [creditScore, setCreditScore] = useState(application.credit_score?.toString() ?? '')
  const [backgroundClear, setBackgroundClear] = useState<boolean | undefined>(application.background_clear)
  const [evictionHistory, setEvictionHistory] = useState(application.eviction_history ?? false)
  const [bankruptcyHistory, setBankruptcyHistory] = useState(application.bankruptcy_history ?? false)
  const [notes, setNotes] = useState(application.screening_notes ?? '')

  const isScreened = application.screening_status === 'Screened'
  const isWaived = application.screening_status === 'Waived'

  const getScoreColor = (score: number) => {
    if (score >= 70) return { text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', ring: 'ring-emerald-500' }
    if (score >= 50) return { text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', ring: 'ring-amber-500' }
    return { text: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', ring: 'ring-red-500' }
  }

  const getRecommendation = (score: number) => {
    if (score >= 70) return { label: 'Approve Recommended', color: 'text-emerald-600' }
    if (score >= 50) return { label: 'Review Recommended', color: 'text-amber-600' }
    return { label: 'Deny Recommended', color: 'text-red-600' }
  }

  const handleSaveAndScore = async () => {
    setSaving(true)

    try {
      // 1. Save manual screening data to the application row
      const { error: updateError } = await supabase
        .from('applications')
        .update({
          credit_score: creditScore ? Number(creditScore) : null,
          background_clear: backgroundClear ?? null,
          eviction_history: evictionHistory,
          bankruptcy_history: bankruptcyHistory,
          screening_notes: notes.trim() || null,
        })
        .eq('id', application.id)

      if (updateError) {
        toast.error('Failed to save screening data: ' + updateError.message)
        setSaving(false)
        return
      }

      // 2. Call the scoring edge function
      setScoring(true)
      const { data: result, error: fnError } = await supabase.functions.invoke('score-application', {
        body: { application_id: application.id },
      })

      if (fnError) {
        toast.error('Scoring failed: ' + fnError.message)
        setScoring(false)
        setSaving(false)
        return
      }
      setBreakdown(result.breakdown)
      toast.success(`Screening complete — Score: ${result.score}/100`)
      onScored()
    } catch (err: any) {
      toast.error('Error: ' + err.message)
    } finally {
      setScoring(false)
      setSaving(false)
    }
  }

  const handleRescore = async () => {
    setScoring(true)
    try {
      // First save any updated fields
      await supabase
        .from('applications')
        .update({
          credit_score: creditScore ? Number(creditScore) : null,
          background_clear: backgroundClear ?? null,
          eviction_history: evictionHistory,
          bankruptcy_history: bankruptcyHistory,
          screening_notes: notes.trim() || null,
          // Reset status so RPC can re-score (RPC checks for Pending status)
          // Actually, RPC checks application.status = 'Pending', not screening_status
        })
        .eq('id', application.id)

      const { data: result, error: fnError } = await supabase.functions.invoke('score-application', {
        body: { application_id: application.id },
      })

      if (fnError) {
        toast.error('Re-scoring failed: ' + fnError.message)
      } else {
        setBreakdown(result.breakdown)
        toast.success(`Re-scored — Score: ${result.score}/100`)
        onScored()
      }
    } catch (err: any) {
      toast.error('Error: ' + err.message)
    } finally {
      setScoring(false)
    }
  }

  // ── SCREENED STATE: Show score breakdown ──
  if (isScreened && application.screening_score != null) {
    const score = application.screening_score
    const colors = getScoreColor(score)
    const rec = getRecommendation(score)

    // Use either fetched breakdown or derive from known data
    const displayBreakdown = breakdown?.categories || null

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
            <ShieldCheck size={14} className="text-emerald-500" /> Screening Results
          </h3>
          <button
            onClick={handleRescore}
            disabled={scoring}
            className="text-[10px] font-bold text-slate-400 hover:text-slate-600 flex items-center gap-1 transition-colors"
          >
            {scoring ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Re-Score
          </button>
        </div>

        {/* Score Circle + Recommendation */}
        <div className={`${colors.bg} ${colors.border} border rounded-2xl p-6 flex items-center gap-6`}>
          <div className={`w-20 h-20 rounded-full border-4 ${colors.border} flex items-center justify-center ${colors.bg}`}>
            <span className={`text-2xl font-black italic ${colors.text}`}>{score}</span>
          </div>
          <div>
            <p className={`text-lg font-black italic ${colors.text}`}>{rec.label}</p>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Scored {application.screened_at ? new Date(application.screened_at).toLocaleDateString() : ''}
            </p>
          </div>
        </div>

        {/* Category Breakdown Bars */}
        {displayBreakdown && (
          <div className="space-y-3">
            {displayBreakdown.map((cat) => {
              const pct = cat.max > 0 ? (cat.score / cat.max) * 100 : 0
              const barColor = pct >= 70 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
              return (
                <div key={cat.name}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{cat.name}</span>
                    <span className="text-[10px] font-black text-slate-700">{cat.score}/{cat.max}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Editable screening data (collapsed) */}
        <details className="group">
          <summary className="text-[10px] font-bold text-slate-400 uppercase tracking-widest cursor-pointer hover:text-slate-600 transition-colors">
            Edit Screening Data
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Credit Score</label>
                <input
                  type="number" min="300" max="850"
                  value={creditScore} onChange={(e) => setCreditScore(e.target.value)}
                  className="w-full p-2 border border-slate-200 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
                  placeholder="300-850"
                />
              </div>
              <div className="flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={backgroundClear ?? false} onChange={(e) => setBackgroundClear(e.target.checked)} />
                  Background Clear
                </label>
              </div>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <input type="checkbox" className="w-4 h-4 accent-red-600" checked={evictionHistory} onChange={(e) => setEvictionHistory(e.target.checked)} />
                Eviction History
              </label>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <input type="checkbox" className="w-4 h-4 accent-red-600" checked={bankruptcyHistory} onChange={(e) => setBankruptcyHistory(e.target.checked)} />
                Bankruptcy History
              </label>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Notes</label>
              <textarea
                value={notes} onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full p-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 resize-none"
                placeholder="Screening notes..."
              />
            </div>
          </div>
        </details>
      </div>
    )
  }

  // ── WAIVED STATE ──
  if (isWaived) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
        <ShieldAlert size={20} className="text-amber-600 flex-shrink-0" />
        <div>
          <p className="font-bold text-amber-900 text-sm">Screening Waived</p>
          <p className="text-amber-700 text-xs mt-0.5">Management bypassed screening for this applicant.</p>
        </div>
      </div>
    )
  }

  // ── UNSCREENED STATE: Manual entry form ──
  return (
    <div className="space-y-4">
      <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
        <Shield size={14} className="text-slate-400" /> Tenant Screening
      </h3>

      <div className="bg-slate-50 rounded-2xl border border-slate-200 p-5 space-y-4">
        <p className="text-xs text-slate-500">Enter screening data below, then score the application.</p>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Credit Score</label>
            <input
              type="number" min="300" max="850"
              value={creditScore} onChange={(e) => setCreditScore(e.target.value)}
              className="w-full p-2.5 border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
              placeholder="300-850"
            />
          </div>
          <div className="flex flex-col justify-center">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input type="checkbox" className="w-4 h-4 accent-emerald-600" checked={backgroundClear ?? false} onChange={(e) => setBackgroundClear(e.target.checked)} />
              Background Clear
            </label>
          </div>
        </div>

        <div className="flex gap-6">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" className="w-4 h-4 accent-red-600" checked={evictionHistory} onChange={(e) => setEvictionHistory(e.target.checked)} />
            <ShieldX size={14} className="text-red-400" /> Eviction History
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" className="w-4 h-4 accent-red-600" checked={bankruptcyHistory} onChange={(e) => setBankruptcyHistory(e.target.checked)} />
            <ShieldX size={14} className="text-red-400" /> Bankruptcy History
          </label>
        </div>

        <div>
          <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1">Screening Notes</label>
          <textarea
            value={notes} onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full p-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 resize-none"
            placeholder="Reference check results, notes from landlord call, etc."
          />
        </div>

        <button
          onClick={handleSaveAndScore}
          disabled={saving || scoring}
          className="w-full py-3 bg-slate-900 text-white font-black rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs"
        >
          {saving || scoring ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              {saving && !scoring ? 'Saving...' : 'Scoring...'}
            </>
          ) : (
            <>
              <Save size={16} /> Save & Score
            </>
          )}
        </button>
      </div>
    </div>
  )
}
