/**
 * /admin/applications/[id] — full v2 application review.
 *
 * Server component that loads the application via getApplicationForAdmin
 * (admin or PM only), renders all the v2 fields, child arrays, co-applicants,
 * and attachments. Admin-side actions (download attachment, resend invite)
 * live in the client component ApplicationDetailClient.
 */
import Link from 'next/link'
import { ArrowLeft, AlertCircle } from 'lucide-react'
import { getApplicationForAdmin } from '@/actions/application-actions-v2'
import { ApplicationDetailClient } from './ApplicationDetailClient'

type Params = Promise<{ id: string }>

export default async function ApplicationDetailPage({
  params,
}: {
  params: Params
}) {
  const { id } = await params
  const result = await getApplicationForAdmin(id)

  if (!result.success) {
    return (
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        <Link
          href="/admin/applications"
          className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500 hover:text-emerald-600"
        >
          <ArrowLeft size={14} /> Back to Applications
        </Link>
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm p-12 text-center max-w-md mx-auto">
          <div className="w-16 h-16 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={32} />
          </div>
          <h1 className="text-2xl font-black italic uppercase text-slate-900">
            Cannot Load Application
          </h1>
          <p className="text-slate-500 text-sm mt-3">{result.message}</p>
        </div>
      </div>
    )
  }

  return <ApplicationDetailClient data={result} />
}
