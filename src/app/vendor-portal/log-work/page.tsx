'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/**
 * DEPRECATED: This page has been replaced by the inline hours/materials
 * logging on the main vendor portal page. Redirecting automatically.
 */
export default function VendorWorkLog() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/vendor-portal')
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <Loader2 className="animate-spin text-slate-400 mx-auto" size={32} />
        <p className="text-sm font-bold text-slate-500 uppercase tracking-widest">
          Redirecting to Vendor Portal...
        </p>
      </div>
    </div>
  )
}
