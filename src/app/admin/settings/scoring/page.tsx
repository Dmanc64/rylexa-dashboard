/**
 * /admin/settings/scoring — Admin-only weight tuning page for the
 * application scoring v2 function.
 *
 * Middleware gates the route to Admin. The settings save action also
 * re-verifies admin role server-side.
 */
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getScoringWeights } from '@/actions/application-actions-v2'
import { ScoringWeightsForm } from './ScoringWeightsForm'

export default async function ScoringSettingsPage() {
  const result = await getScoringWeights()

  if (!result.success) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-12 text-center">
          <p className="text-slate-500 text-sm">{result.message}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6 animate-in fade-in">
      <Link
        href="/admin/settings"
        className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-600 transition-colors"
      >
        <ArrowLeft size={14} /> Back to Settings
      </Link>

      <div>
        <p className="text-slate-400 font-bold text-[10px] uppercase tracking-widest mb-2">
          Application Scoring
        </p>
        <h1 className="text-4xl font-black italic uppercase text-slate-900">
          Scoring <span className="text-emerald-600">Weights</span>
        </h1>
        <p className="text-slate-500 text-sm mt-3 max-w-2xl">
          Tune how much each factor contributes to an applicant&apos;s 0–100 score.
          Weights are normalized to sum to 100 on save. Changing them affects future
          submissions; existing scores stay frozen until you click &quot;Re-score&quot;
          on an individual application.
        </p>
      </div>

      <ScoringWeightsForm
        initialWeights={result.weights}
        updatedAt={result.updated_at}
      />
    </div>
  )
}
