'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Save, RotateCcw, Loader2 } from 'lucide-react'
import {
  setScoringWeights,
  type ScoringWeights,
} from '@/actions/application-actions-v2'

const DEFAULTS: ScoringWeights = {
  income: 30, employment: 15, reserves: 10, residential: 10,
  debt: 10, flags: 15, completeness: 5, documents: 5,
}

const FACTOR_INFO: Array<{ key: keyof ScoringWeights; name: string; blurb: string }> = [
  { key: 'income',       name: 'Income ratio',         blurb: '3.0x rent = full credit; 1.0x = 0. Includes additional income + submitted co-applicants.' },
  { key: 'employment',   name: 'Employment tenure',    blurb: '5+ years at current employer = full credit. Linear from 0.' },
  { key: 'reserves',     name: 'Cash reserves',        blurb: '3+ months of rent in bank accounts = full credit.' },
  { key: 'residential',  name: 'Residential stability', blurb: '2+ years at current address = full credit.' },
  { key: 'debt',         name: 'Debt load',             blurb: 'Lower credit card balance vs income = higher score.' },
  { key: 'flags',        name: 'Screening flags',       blurb: 'All 5 yes/no questions answered "no" = full credit. Each "yes" subtracts 1/5.' },
  { key: 'completeness', name: 'Completeness',          blurb: 'Percentage of optional fields populated.' },
  { key: 'documents',    name: 'Documents',             blurb: 'Any file attached = full credit.' },
]

export function ScoringWeightsForm({
  initialWeights,
  updatedAt,
}: {
  initialWeights: ScoringWeights
  updatedAt: string | null
}) {
  const [weights, setWeights] = useState<ScoringWeights>(initialWeights)
  const [saving, setSaving] = useState(false)

  const total = useMemo(
    () => Object.values(weights).reduce((a, b) => a + b, 0),
    [weights]
  )

  const onSave = async () => {
    setSaving(true)
    const r = await setScoringWeights(weights)
    setSaving(false)
    if (r.success && r.weights) {
      setWeights(r.weights)
      toast.success('Weights saved and normalized to sum=100.')
    } else {
      toast.error(r.message ?? 'Save failed')
    }
  }

  const onReset = () => {
    setWeights(DEFAULTS)
  }

  return (
    <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm p-6 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
            Current sum
          </p>
          <p className={`text-3xl font-black italic ${total === 100 ? 'text-emerald-600' : 'text-amber-600'}`}>
            {total}
            <span className="text-base text-slate-400"> / 100</span>
          </p>
          {total !== 100 && (
            <p className="text-[10px] text-amber-600 mt-1">
              Will normalize to 100 on save.
            </p>
          )}
        </div>
        {updatedAt && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 text-right">
            Last updated<br />{new Date(updatedAt).toLocaleString()}
          </p>
        )}
      </div>

      <div className="space-y-4">
        {FACTOR_INFO.map((f) => (
          <div key={f.key} className="bg-slate-50 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-black text-slate-900">{f.name}</p>
                <p className="text-[11px] text-slate-500">{f.blurb}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={weights[f.key]}
                  onChange={(e) => {
                    const v = e.target.value === '' ? 0 : Math.max(0, Math.min(100, Number(e.target.value)))
                    setWeights((prev) => ({ ...prev, [f.key]: v }))
                  }}
                  className="w-20 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono font-bold text-right outline-none focus:ring-2 focus:ring-emerald-500/20"
                />
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 w-8">pts</span>
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={weights[f.key]}
              onChange={(e) => setWeights((prev) => ({ ...prev, [f.key]: Number(e.target.value) }))}
              className="w-full accent-emerald-600"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
        <button
          onClick={onReset}
          disabled={saving}
          className="px-5 py-3 bg-white border border-slate-200 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
        >
          <RotateCcw size={12} /> Reset to defaults
        </button>
        <button
          onClick={onSave}
          disabled={saving || total === 0}
          className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 disabled:opacity-60 flex items-center gap-2"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
          Save Weights
        </button>
      </div>
    </div>
  )
}
