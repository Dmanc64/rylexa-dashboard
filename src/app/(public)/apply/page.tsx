/**
 * /apply — public rental application entry point.
 *
 * Behavior:
 *  - `/apply`                    → new draft is created, redirected to /apply?token=<draft_token>
 *  - `/apply?token=<uuid>`       → resume an existing draft
 *  - `/apply?unit=<unit_id>`     → new draft pre-selected to that unit
 *  - `/apply?token=<uuid>&...`   → token wins; resume happens
 *
 * Renders the multi-step wizard with the loaded application state.
 */
import { redirect } from 'next/navigation'
import {
  createDraft,
  getApplicationByDraftToken,
} from '@/actions/application-actions-v2'
import { ApplicationWizard } from './ApplicationWizard'

type SearchParams = Promise<{
  token?: string
  unit?: string
}>

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const sp = await searchParams
  const token = typeof sp.token === 'string' ? sp.token : undefined
  const unitParam = typeof sp.unit === 'string' ? sp.unit : undefined

  // ── RESUME FLOW ──
  if (token) {
    const result = await getApplicationByDraftToken(token)
    if (!result.success) {
      return (
        <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-12 max-w-md text-center">
            <h1 className="text-2xl font-black italic uppercase text-slate-900">
              Link Expired
            </h1>
            <p className="text-slate-500 text-sm mt-3">
              {result.message ?? 'This application link is no longer valid.'}
            </p>
            <a
              href="/apply"
              className="inline-block mt-6 px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-colors"
            >
              Start a new application
            </a>
          </div>
        </main>
      )
    }

    return (
      <ApplicationWizard
        draftToken={token}
        initialState={result as unknown as InitialState}
      />
    )
  }

  // ── NEW DRAFT FLOW ──
  const createResult = await createDraft({
    unit_id: unitParam ?? null,
    draft_email: null,
  })

  if (!createResult.success) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-12 max-w-md text-center">
          <h1 className="text-2xl font-black italic uppercase text-slate-900">
            Something Went Wrong
          </h1>
          <p className="text-slate-500 text-sm mt-3">
            {createResult.message ?? 'Could not start a new application.'}
          </p>
        </div>
      </main>
    )
  }

  // Redirect so the URL has the token and a refresh resumes correctly
  redirect(`/apply?token=${createResult.draft_token}`)
}

/* Shape of what getApplicationByDraftToken returns. Kept loose because the
   ApplicationWizard component validates / normalizes each field itself. */
type InitialState = {
  success: true
  application: Record<string, unknown> & { id: string; ssn_on_file: boolean; gov_id_on_file: boolean }
  phones: unknown[]
  emails: unknown[]
  addresses: unknown[]
  dependents: unknown[]
  pets: unknown[]
  bank_accounts: unknown[]
  credit_cards: unknown[]
  additional_income: unknown[]
  emergency_contacts: unknown[]
  coapplicants: unknown[]
  attachments: unknown[]
}
