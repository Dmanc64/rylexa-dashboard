'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { Save, User, DollarSign, Calendar } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  lease: {
    lease_id: string
    rent_amount: number
    end_date: string | null
    first_name: string
    last_name: string
    // We need to fetch email/phone separately or pass them in
    // For simplicity, we will fetch fresh details on open
  } | null
}

export default function EditLeaseModal({ isOpen, onClose, onSuccess, lease }: Props) {
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  
  const [formData, setFormData] = useState({
    rent: '',
    deposit: '',
    utility_fee: '',
    end_date: '',
    email: '',
    phone: ''
  })

  // Fetch full details when modal opens
  useEffect(() => {
    if (isOpen && lease) {
      setFetching(true)
      const fetchDetails = async () => {
        // Get full lease + tenant info
        const { data: leaseData } = await supabase
          .from('leases')
          .select('rent_amount, security_deposit, end_date, tenant_id, utility_fee')
          .eq('id', lease.lease_id)
          .single()

        if (leaseData) {
          const { data: tenantData } = await supabase
            .from('tenants')
            .select('email, phone')
            .eq('id', leaseData.tenant_id)
            .single()

          setFormData({
            rent: leaseData.rent_amount?.toString() || '',
            deposit: leaseData.security_deposit?.toString() || '',
            utility_fee: leaseData.utility_fee?.toString() || '0',
            end_date: leaseData.end_date || '',
            email: tenantData?.email || '',
            phone: tenantData?.phone || ''
          })
        }
        setFetching(false)
      }
      fetchDetails()
    }
  }, [isOpen, lease])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!lease) return
    setLoading(true)

    try {
      const { error } = await supabase.rpc('update_lease_details', {
        p_lease_id: lease.lease_id,
        p_rent: Number(formData.rent),
        p_deposit: Number(formData.deposit),
        p_end_date: formData.end_date || null,
        p_phone: formData.phone,
        p_email: formData.email,
        p_utility_fee: Number(formData.utility_fee) || 0
      })

      if (error) throw error
      onSuccess()
      onClose()
    } catch (error) {
      toast.error('Error updating: ' + (error as any).message)
    } finally {
      setLoading(false)
    }
  }

  if (!lease) return null

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title={`Edit Lease: ${lease.first_name} ${lease.last_name}`} size="max-w-lg" headerBg="bg-gray-50">
        {fetching ? (
          <div className="p-8 text-center text-gray-500">Loading details...</div>
        ) : (
          <form onSubmit={handleSave} className="p-6 space-y-6">
            
            {/* Financials */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <DollarSign className="w-4 h-4" /> Financials
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Monthly Rent</label>
                  <input className="border rounded-lg p-2 w-full" type="number"
                    value={formData.rent} onChange={e => setFormData({...formData, rent: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Security Deposit</label>
                  <input className="border rounded-lg p-2 w-full" type="number"
                    value={formData.deposit} onChange={e => setFormData({...formData, deposit: e.target.value})} />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Utility Fee</label>
                  <input className="border rounded-lg p-2 w-full" type="number" step="0.01"
                    value={formData.utility_fee} onChange={e => setFormData({...formData, utility_fee: e.target.value})} />
                </div>
              </div>
            </div>

            {/* Dates */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Lease Duration
              </h3>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Lease End Date (Leave empty for MTM)</label>
                <input className="border rounded-lg p-2 w-full" type="date" 
                  value={formData.end_date} onChange={e => setFormData({...formData, end_date: e.target.value})} />
              </div>
            </div>

            {/* Contact Info */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <User className="w-4 h-4" /> Tenant Contact
              </h3>
              <div className="grid grid-cols-1 gap-3">
                <input placeholder="Email" aria-label="Email" className="border rounded-lg p-2 w-full"
                  value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                <input placeholder="Phone" aria-label="Phone" className="border rounded-lg p-2 w-full"
                  value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2">
                <Save className="w-4 h-4" /> {loading ? 'Saving...' : 'Save Changes'}
              </button>
            </div>

          </form>
        )}
    </AccessibleModal>
  )
}