'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { Check, User, Calendar, Search, AlertCircle } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  propertyId?: string
  propertyName?: string
}

type ExistingTenant = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
}

export default function NewLeaseModal({ isOpen, onClose, onSuccess, propertyId, propertyName }: Props) {
  const [properties, setProperties] = useState<{ id: string, name: string }[]>([])
  const [units, setUnits] = useState<{ id: string, name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedPropId, setSelectedPropId] = useState(propertyId || '')
  
  // --- NEW: Tenant Match State ---
  const [potentialMatches, setPotentialMatches] = useState<ExistingTenant[]>([])
  const [selectedExistingTenant, setSelectedExistingTenant] = useState<ExistingTenant | null>(null)

  const [formData, setFormData] = useState({
    unit_id: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    rent: '',
    deposit: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: ''
  })

  // 1. Fetch Properties & pre-select if propertyId provided
  useEffect(() => {
    if (isOpen) {
      supabase.from('properties').select('id, name').order('name')
        .then(({ data }) => data && setProperties(data))
      if (propertyId) setSelectedPropId(propertyId)
    }
  }, [isOpen, propertyId])

  // 2. Fetch Vacant Units
  useEffect(() => {
    if (selectedPropId) {
      supabase.from('units').select('id, name')
        .eq('property_id', selectedPropId).eq('status', 'Vacant').order('name')
        .then(({ data }) => setUnits(data || []))
    } else {
      setUnits([])
    }
  }, [selectedPropId])

  // 3. --- SMART SEARCH LOGIC ---
  useEffect(() => {
    const checkTenant = async () => {
      // Only search if we have at least 3 chars of a last name
      if (formData.last_name.length < 3) {
        setPotentialMatches([])
        return
      }

      // Escape PostgREST wildcards in user input
      const safeLast = formData.last_name.replace(/[%_]/g, '')
      const safeFirst = formData.first_name.replace(/[%_]/g, '')
      const { data } = await supabase
        .from('tenants')
        .select('id, first_name, last_name, email, phone')
        .ilike('last_name', `${safeLast}%`)
        .ilike('first_name', `${safeFirst}%`)
        .limit(3)

      if (data) setPotentialMatches(data)
    }

    // Debounce: Wait 500ms after typing stops before searching
    const timer = setTimeout(checkTenant, 500)
    return () => clearTimeout(timer)
  }, [formData.first_name, formData.last_name])


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const { error } = await supabase.rpc('move_in_tenant', {
        p_unit_id: formData.unit_id,
        p_first_name: formData.first_name,
        p_last_name: formData.last_name,
        p_email: formData.email,
        p_phone: formData.phone,
        p_rent: Number(formData.rent),
        p_deposit: Number(formData.deposit),
        p_start_date: formData.start_date,
        p_end_date: formData.end_date || null,
        // PASS THE ID IF WE FOUND A MATCH
        p_existing_tenant_id: selectedExistingTenant?.id || null 
      })

      if (error) throw error
      onSuccess()
      onClose()
      setFormData({ ...formData, first_name: '', last_name: '', unit_id: '' })
      setSelectedExistingTenant(null)
      
    } catch (error) {
      toast.error('Error: ' + (error as any).message)
    } finally {
      setLoading(false)
    }
  }

  // Helper to "Pick" a person
  const selectPerson = (t: ExistingTenant) => {
    setSelectedExistingTenant(t)
    setFormData({
      ...formData,
      first_name: t.first_name,
      last_name: t.last_name,
      email: t.email || '',
      phone: t.phone || ''
    })
    setPotentialMatches([]) // Clear list
  }

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title="New Move-In Wizard" size="max-w-2xl" headerBg="bg-gray-50">
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          
          {/* Property & Unit */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Property</label>
              {propertyId ? (
                <input className="w-full border rounded-lg p-2 bg-gray-50 text-gray-700" value={propertyName || properties.find(p => p.id === propertyId)?.name || 'Selected Property'} disabled />
              ) : (
                <select className="w-full border rounded-lg p-2" value={selectedPropId} onChange={e => setSelectedPropId(e.target.value)} required>
                  <option value="">Select Property...</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Unit</label>
              <select className="w-full border rounded-lg p-2" value={formData.unit_id} onChange={e => setFormData({...formData, unit_id: e.target.value})} disabled={!selectedPropId} required>
                <option value="">Select Unit...</option>
                {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          </div>

          {/* Tenant Details with AUTO-COMPLETE */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold border-b pb-2">Tenant Details</h3>
            
            {/* ALERT: If existing tenant selected */}
            {selectedExistingTenant && (
              <div className="bg-blue-50 text-blue-800 p-3 rounded-lg flex justify-between items-center text-sm">
                <span>
                  Using existing record: <strong>{selectedExistingTenant.first_name} {selectedExistingTenant.last_name}</strong>
                </span>
                <button type="button" onClick={() => setSelectedExistingTenant(null)} className="text-blue-600 underline">
                  Clear
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 relative">
              <input placeholder="First Name" aria-label="First Name" className="border rounded-lg p-2" required
                value={formData.first_name}
                onChange={e => setFormData({...formData, first_name: e.target.value})}
                disabled={!!selectedExistingTenant}
              />
              <input placeholder="Last Name" aria-label="Last Name" className="border rounded-lg p-2" required
                value={formData.last_name}
                onChange={e => setFormData({...formData, last_name: e.target.value})}
                disabled={!!selectedExistingTenant}
              />

              {/* DROPDOWN FOR MATCHES */}
              {potentialMatches.length > 0 && !selectedExistingTenant && (
                <div className="absolute top-12 left-0 right-0 bg-white shadow-xl border rounded-lg z-10">
                  <div className="p-2 text-xs text-gray-500 bg-gray-50 border-b">
                    Possible matches found in database:
                  </div>
                  {potentialMatches.map(t => (
                    <div 
                      key={t.id} 
                      onClick={() => selectPerson(t)}
                      className="p-3 hover:bg-blue-50 cursor-pointer flex justify-between items-center"
                    >
                      <div>
                        <div className="font-bold text-gray-800">{t.first_name} {t.last_name}</div>
                        <div className="text-xs text-gray-500">{t.email || 'No Email'} • {t.phone || 'No Phone'}</div>
                      </div>
                      <div className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">Select</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <input placeholder="Email" aria-label="Email" className="border rounded-lg p-2"
                value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})}
              />
              <input placeholder="Phone" aria-label="Phone" className="border rounded-lg p-2"
                value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})}
              />
            </div>
          </div>

          {/* Lease Terms */}
          <div className="space-y-4">
             {/* Same as before... */}
             <div className="grid grid-cols-2 gap-4">
                <div>
                   <label className="text-xs text-gray-500">Rent</label>
                   <input className="border rounded-lg p-2 w-full" type="number" required value={formData.rent} onChange={e => setFormData({...formData, rent: e.target.value})} />
                </div>
                <div>
                   <label className="text-xs text-gray-500">Deposit</label>
                   <input className="border rounded-lg p-2 w-full" type="number" value={formData.deposit} onChange={e => setFormData({...formData, deposit: e.target.value})} />
                </div>
                <div>
                   <label className="text-xs text-gray-500">Start Date</label>
                   <input className="border rounded-lg p-2 w-full" type="date" required value={formData.start_date} onChange={e => setFormData({...formData, start_date: e.target.value})} />
                </div>
                <div>
                   <label className="text-xs text-gray-500">End Date</label>
                   <input className="border rounded-lg p-2 w-full" type="date" value={formData.end_date} onChange={e => setFormData({...formData, end_date: e.target.value})} />
                </div>
             </div>
          </div>

          <div className="pt-4 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={loading} className="px-6 py-2 bg-blue-600 text-white rounded-lg flex items-center gap-2">
              {loading ? 'Processing...' : <><Check className="w-4 h-4" /> Complete Move-In</>}
            </button>
          </div>

        </form>
    </AccessibleModal>
  )
}