'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

/**
 * Error boundary for the /vendor-portal route segment.
 */
export default function VendorPortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[Rylexa Vendor Portal Error Boundary]', {
      message: error.message,
      digest: error.digest,
      timestamp: new Date().toISOString(),
    })
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-8">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-10 max-w-lg w-full text-center">
        <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <AlertTriangle size={32} className="text-red-500" />
        </div>
        <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight mb-2">
          Something Went Wrong
        </h2>
        <p className="text-sm text-slate-500 mb-6">
          An unexpected error occurred. Your data is safe.
        </p>
        <button
          onClick={reset}
          className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-600 transition-all mx-auto"
        >
          <RefreshCw size={14} />
          Try Again
        </button>
      </div>
    </div>
  )
}
