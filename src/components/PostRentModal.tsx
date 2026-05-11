'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { CheckCircle, DollarSign, Loader2 } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function PostRentModal({ isOpen, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(false)
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [resultCount, setResultCount] = useState<number | null>(null)

  const handlePost = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('post_monthly_rent', {
        target_date: date
      })

      if (error) throw error
      setResultCount(data)
      if (onSuccess) onSuccess() 
    } catch (err) {
      toast.error('Error posting rent: ' + (err as any).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title="Post Monthly Rent" size="max-w-md" headerBg="bg-blue-600" closeBtnColor="text-blue-200" headerTextColor="text-white">
        <div className="p-6 space-y-6">
          {resultCount === null ? (
            <>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                <p className="text-sm text-blue-800">
                  This will generate <strong>Rent Charges</strong> for all active leases. 
                  Existing charges for the selected month will be skipped.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Posting Date</label>
                <input 
                  type="date" 
                  className="w-full border rounded-lg p-2 font-medium text-gray-900"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <button 
                onClick={handlePost} 
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition"
              >
                {loading ? <Loader2 className="animate-spin" /> : 'Run Rent Roll'}
              </button>
            </>
          ) : (
            <div className="text-center py-6 space-y-4">
               <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto">
                 <CheckCircle className="w-8 h-8" />
               </div>
               <div>
                 <h3 className="text-xl font-bold text-gray-900">Success!</h3>
                 <p className="text-gray-500">Posted <strong>{resultCount}</strong> new rent charges.</p>
               </div>
               <button onClick={onClose} className="bg-gray-100 text-gray-700 font-bold px-6 py-2 rounded-lg hover:bg-gray-200">Close</button>
            </div>
          )}
        </div>
    </AccessibleModal>
  )
}