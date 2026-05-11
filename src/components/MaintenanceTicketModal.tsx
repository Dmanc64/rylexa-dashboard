'use client'

import { useState, useEffect } from 'react'
import { Save, Loader2, AlertTriangle, CheckCircle } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { Ticket, Vendor } from '@/hooks/useMaintenance'

interface ModalProps {
  isOpen: boolean
  ticket: Ticket
  vendors: Vendor[]
  onClose: () => void
  onSave: (id: string, updates: Partial<Ticket>) => Promise<boolean>
  isSaving: boolean
}

export default function MaintenanceTicketModal({ isOpen, ticket, vendors, onClose, onSave, isSaving }: ModalProps) {
  const [form, setForm] = useState({
    status: ticket.status,
    assigned_vendor: ticket.assigned_vendor || '',
    cost: ticket.cost || 0,
    notes: ticket.notes || ''
  })
  const [vendorSearch, setVendorSearch] = useState(ticket.assigned_vendor || '')
  const [showVendorList, setShowVendorList] = useState(false)

  // Re-sync form state when a different ticket is opened
  useEffect(() => {
    if (isOpen) {
      setForm({
        status: ticket.status,
        assigned_vendor: ticket.assigned_vendor || '',
        cost: ticket.cost || 0,
        notes: ticket.notes || ''
      })
      setVendorSearch(ticket.assigned_vendor || '')
      setShowVendorList(false)
    }
  }, [isOpen, ticket.id])

  const filteredVendors = vendors.filter(v => 
    (v.contact_name?.toLowerCase().includes(vendorSearch.toLowerCase()) || 
     v.company_name?.toLowerCase().includes(vendorSearch.toLowerCase()))
  )

  const handleSave = async () => {
    const success = await onSave(ticket.id, form)
    if (success) onClose()
  }

  return (
    <AccessibleModal isOpen={isOpen} onClose={onClose} title={ticket.title} subtitle={`${ticket.unit_name} • ${ticket.property_name}`} size="max-w-2xl">
        {/* Body */}
        <div className="p-8 space-y-6">
          <div className="bg-amber-50 p-6 rounded-2xl border border-amber-100 flex gap-4">
             <AlertTriangle className="text-amber-600 shrink-0" size={20} />
             <p className="text-slate-800 text-sm font-medium italic leading-relaxed">"{ticket.description}"</p>
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label htmlFor="ticket-status" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Current Status</label>
              <select
                id="ticket-status"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as any })}
              >
                {['Open', 'In Progress', 'Completed', 'Closed'].map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label htmlFor="repair-cost" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Repair Cost ($)</label>
              <input
                id="repair-cost"
                type="number"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500"
                value={form.cost}
                onChange={(e) => setForm({ ...form, cost: Number(e.target.value) })}
              />
            </div>
          </div>

          {/* Vendor Search */}
          <div className="relative space-y-2">
             <label htmlFor="vendor-search" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Assigned Vendor</label>
             <input
                id="vendor-search"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search approved vendors..."
                value={vendorSearch}
                onFocus={() => setShowVendorList(true)}
                onChange={(e) => { setVendorSearch(e.target.value); setShowVendorList(true); }}
             />
             {showVendorList && vendorSearch && (
                <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl z-50 overflow-hidden max-h-40 overflow-y-auto">
                    {filteredVendors.map(v => (
                        <div key={v.id} 
                             className="px-6 py-3 hover:bg-blue-50 cursor-pointer text-sm font-bold text-slate-700 border-b border-slate-50 last:border-0"
                             onMouseDown={() => {
                                 const name = v.company_name || v.contact_name || ''
                                 setVendorSearch(name)
                                 setForm({ ...form, assigned_vendor: name })
                                 setShowVendorList(false)
                             }}
                        >
                            {v.company_name || v.contact_name}
                        </div>
                    ))}
                </div>
             )}
          </div>

          <div className="space-y-2">
             <label htmlFor="manager-notes" className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Manager Notes</label>
             <textarea
                id="manager-notes"
                className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium text-sm outline-none focus:ring-2 focus:ring-blue-500 h-24 resize-none"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
             />
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-6 border-t border-slate-100 bg-slate-50 flex justify-end gap-4">
          <button onClick={onClose} className="px-6 py-3 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:text-slate-900 transition-colors">Cancel Changes</button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-8 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="animate-spin w-4 h-4" /> : <Save size={16} />}
            SAVE RECORD
          </button>
        </div>
    </AccessibleModal>
  )
}