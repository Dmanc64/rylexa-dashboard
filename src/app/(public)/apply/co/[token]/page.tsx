/**
 * /apply/co/[token] — co-applicant portal.
 *
 * A focused subset of the primary applicant wizard. A co-applicant lands here
 * via the email invite sent on the primary's submit. The page resolves the
 * portal_token via getCoApplicantFull (which also promotes Invited → Started)
 * and renders the CoApplicantWizard with their existing data hydrated.
 */
import { getCoApplicantFull } from '@/actions/application-actions-v2'
import { CoApplicantWizard } from './CoApplicantWizard'

type Params = Promise<{ token: string }>

export default async function CoApplicantPortalPage({
  params,
}: {
  params: Params
}) {
  const { token } = await params
  const result = await getCoApplicantFull(token)

  if (!result.success) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-12 max-w-md text-center">
          <h1 className="text-2xl font-black italic uppercase text-slate-900">
            Link Expired
          </h1>
          <p className="text-slate-500 text-sm mt-3">
            {result.message ?? 'This invitation link is no longer valid.'}
          </p>
          <p className="text-xs text-slate-400 mt-6">
            If you believe this is a mistake, contact the person who invited you.
          </p>
        </div>
      </main>
    )
  }

  return (
    <CoApplicantWizard
      portalToken={token}
      coapplicant={result.coapplicant as CoApplicantInitial}
      parentApplication={result.parent_application}
      initialAttachments={result.attachments as InitialAttachment[]}
    />
  )
}

type CoApplicantInitial = {
  id: string
  application_id: string
  full_name: string
  email: string
  applicant_type: 'Co-Signer' | 'Other Applicant'
  status: string
  submitted_at: string | null
  invite_sent_at: string | null
  phone: string | null
  date_of_birth: string | null
  ssn_last_4: string | null
  ssn_on_file: boolean
  gov_id_issuing_state: string | null
  gov_id_on_file: boolean
  current_street_1: string | null
  current_street_2: string | null
  current_city: string | null
  current_state: string | null
  current_postal_code: string | null
  current_occupancy_type: string | null
  current_monthly_payment: number | null
  current_landlord_name: string | null
  current_landlord_phone: string | null
  employer: string | null
  employer_phone: string | null
  position_held: string | null
  years_worked: number | null
  monthly_salary: number | null
  supervisor_name: string | null
  supervisor_email: string | null
  q_delinquent_payment: boolean | null
  q_felony_conviction: boolean | null
  q_sued_landlord: boolean | null
  q_water_filled_furniture: boolean | null
  q_smoker: boolean | null
  notes: string | null
}

type InitialAttachment = {
  id: string
  file_name: string
  file_path: string
  file_size: number | null
  mime_type: string | null
  label: string | null
  uploaded_at: string
}
