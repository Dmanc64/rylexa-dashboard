'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { Truck, ArrowRight } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  lease: {
    lease_id: string
    first_name: string
    last_name: string
    property_name: string
    unit_name: string
  } | null
}

export default function MoveLeaseModal({ isOpen, onClose, onSuccess, lease }: Props) {
  const [properties, setProperties] = useState<{ id: string, name: string }[]>([])
  const [units, setUnits] = useState<{ id: string, name: string }[]>([])
  const [loading, setLoading] = useState(false)

  // Selection States
  const [selectedPropId, setSelectedPropId] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState('')

  // 1. Fetch Properties on Open
  useEffect(() => {
    if (isOpen) {
      const fetchProps = async () => {
        const { data } = await supabase.from('properties').select('id, name').order('name')
        if (data) setProperties(data)
      }
      fetchProps()
    }
  }, [isOpen])

  // 2. Fetch Vacant Units when Property Changes
  useEffect(() => {
    if (selectedPropId) {
      const fetchUnits = async () => {
        // Only fetch VACANT units in the target property
        const { data } = await supabase
          .from('units')
          .select('id, name')
          .eq('property_id', selectedPropId)
          .eq('status', 'Vacant') 
          .order('name')
        
        if (data) setUnits(data)
      }
      fetchUnits()
    } else {
      setUnits([])
    }
  }, [selectedPropId])

  const handleMove = async () => {
    if (!lease || !selectedUnitId) return
    setLoading(true)

    try {
      const { error } = await supabase.rpc('move_lease_to_new_unit', {
        p_lease_id: lease.lease_id,
        p_new_unit_id: selectedUnitId
      })

      if (error) throw error
      
      onSuccess()
      onClose()
      setSelectedPropId('')
      setSelectedUnitId('')
      
    } catch (error) {
      toast.error('Error moving lease: ' + (error as any).message)
    } finally {
      setLoading(false)
    }
  }

  if (!lease) return null

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title="Transfer Lease" size="max-w-lg" headerBg="bg-blue-50" closeBtnColor="text-blue-400">
        <div className="p-6 space-y-6">
          
          {/* Current Location */}
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
            <p className="text-xs text-gray-500 uppercase font-semibold">Current Location</p>
            <p className="text-gray-900 font-medium mt-1">
              {lease.property_name} <span className="text-gray-400 mx-2">•</span> Unit {lease.unit_name}
            </p>
            <p className="text-sm text-gray-600 mt-1">{lease.first_name} {lease.last_name}</p>
          </div>

          <div className="flex justify-center">
             <ArrowRight className="text-gray-300 w-6 h-6 animate-pulse" />
          </div>

          {/* New Location Form */}
          <div className="space-y-4">
             <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Move to Property</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg p-2"
                  value={selectedPropId}
                  onChange={(e) => setSelectedPropId(e.target.value)}
                >
                  <option value="">Select Property...</option>
                  {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
             </div>

             <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Select Correct Unit</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg p-2 disabled:bg-gray-100"
                  value={selectedUnitId}
                  onChange={(e) => setSelectedUnitId(e.target.value)}
                  disabled={!selectedPropId}
                >
                  <option value="">Select Vacant Unit...</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
             </div>
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg">
              Cancel
            </button>
            <button 
              onClick={handleMove} 
              disabled={loading || !selectedUnitId}
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Moving...' : 'Confirm Transfer'}
            </button>
          </div>

        </div>
    </AccessibleModal>
  )
}