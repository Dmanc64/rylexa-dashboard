'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { LogOut, AlertTriangle } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  leaseId: string
  tenantName: string
  unitName: string
}

export default function EndLeaseModal({ isOpen, onClose, onSuccess, leaseId, tenantName, unitName }: Props) {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [loading, setLoading] = useState(false)

  const handleMoveOut = async () => {
    setLoading(true)
    try {
      const { error } = await supabase.rpc('end_lease', {
        p_lease_id: leaseId,
        p_move_out_date: date
      })

      if (error) throw error
      onSuccess()
      onClose()
    } catch (error) {
      toast.error('Error: ' + (error as any).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title="Move Out Tenant" size="max-w-md" headerBg="bg-red-50" closeBtnColor="text-red-400">
        <div className="p-6 space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0" />
            <p className="text-sm text-yellow-800">
              This will end the lease for <strong>{tenantName}</strong> in <strong>{unitName}</strong> and mark the unit as Vacant.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Official Move-Out Date</label>
            <input 
              type="date" 
              className="w-full border rounded-lg p-2"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button 
              onClick={handleMoveOut} 
              disabled={loading}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
            >
              {loading ? 'Processing...' : 'Confirm Move Out'}
            </button>
          </div>
        </div>
    </AccessibleModal>
  )
}