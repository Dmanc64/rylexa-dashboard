'use client'

import { useEffect } from 'react'
import { AlertTriangle, RefreshCw, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

/**
 * Next.js App Router error boundary for the /admin route segment.
 * Catches unhandled errors in any admin page and displays a recovery UI
 * instead of a white screen. Logs errors for future observability integration.
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log error for observability. In production, replace with Sentry/LogRocket/etc.
    console.error('[Rylexa Admin Error Boundary]', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
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

        <p className="text-sm text-slate-500 mb-6 leading-relaxed">
          An unexpected error occurred while loading this page.
          Your data is safe — this is a display issue.
        </p>

        {/* Show error digest in dev for debugging, never the full stack */}
        {error.digest && (
          <p className="text-xs text-slate-400 font-mono mb-6 bg-slate-50 p-3 rounded-xl">
            Error Reference: {error.digest}
          </p>
        )}

        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-emerald-600 transition-all"
          >
            <RefreshCw size={14} />
            Try Again
          </button>

          <Link
            href="/admin"
            className="flex items-center gap-2 px-6 py-3 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-slate-200 transition-all"
          >
            <ArrowLeft size={14} />
            Dashboard
          </Link>
        </div>
      </div>
    </div>
  )
}
