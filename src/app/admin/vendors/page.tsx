'use client'

import { useState } from 'react'
import {
  Wrench, Search, Phone, Mail, FileText,
  Ban, Plus, Filter, Loader2, MapPin,
  MoreHorizontal, ShieldCheck, DollarSign,
  ChevronLeft, ChevronRight
} from 'lucide-react'
import { useVendors, type Vendor } from '@/hooks/useVendors'
import VendorFormModal from '@/components/VendorFormModal'
import { usePermissions } from '@/hooks/usePermissions'

export default function VendorDirectory() {
  const { vendors, trades, loading, toggleStatus } = useVendors()
  const { can: hasPermission } = usePermissions()
  const canEditVendors = hasPermission('vendors', 'edit')
  const [filter, setFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const VENDORS_PER_PAGE = 30

  // --- FILTERING LOGIC ---
  const filteredVendors = vendors.filter(v => {
    const matchesTrade = filter === 'All' || (v.trade_type || '').split(',').map(t => t.trim()).includes(filter)

    const searchTerm = search.toLowerCase()
    const matchesSearch =
      !search ||
      (v.company_name || '').toLowerCase().includes(searchTerm) ||
      (v.contact_name || '').toLowerCase().includes(searchTerm) ||
      (v.trade_type || '').toLowerCase().includes(searchTerm) ||
      (v.email || '').toLowerCase().includes(searchTerm) ||
      (v.phone || '').toLowerCase().includes(searchTerm)

    return matchesTrade && matchesSearch
  })

  // --- PAGINATION ---
  const totalPages = Math.ceil(filteredVendors.length / VENDORS_PER_PAGE)
  const paginatedVendors = filteredVendors.slice(
    (currentPage - 1) * VENDORS_PER_PAGE,
    currentPage * VENDORS_PER_PAGE
  )

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">
      
      {/* HEADER SECTION */}
      <div className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
            Vendor <span className="text-emerald-600">Network</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
            {filteredVendors.length === vendors.length
              ? `${vendors.length} Approved Contractors`
              : `${filteredVendors.length} of ${vendors.length} Vendors`
            } • Compliance Monitored
          </p>
        </div>
        {canEditVendors && (
          <button
            onClick={() => { setEditingVendor(null); setIsFormOpen(true) }}
            className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2 shadow-lg hover:-translate-y-1"
          >
             <Plus size={16} /> Onboard Vendor
          </button>
        )}
      </div>

      {/* CONTROLS BAR */}
      <div className="max-w-7xl mx-auto bg-white p-2 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col md:flex-row gap-2 mb-8">
         
         {/* Trade Filter Dropdown */}
         <div className="relative min-w-[200px]">
             <Filter className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
             <select 
                value={filter}
                onChange={(e) => { setFilter(e.target.value); setCurrentPage(1) }}
                className="w-full pl-10 pr-8 py-3 bg-slate-50 border-none rounded-xl font-bold text-xs uppercase tracking-wider text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500/20 cursor-pointer appearance-none"
             >
                <option value="All">All Trades</option>
                {trades.map(t => <option key={t} value={t}>{t}</option>)}
             </select>
         </div>

         {/* Search Input */}
         <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by name, email, trade, or phone..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }}
              className="w-full pl-10 pr-4 py-3 bg-slate-50 border-none rounded-xl font-bold text-sm text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20 placeholder:text-slate-400"
            />
         </div>
      </div>

      {/* VENDOR GRID */}
      {loading ? (
        <div className="py-32 flex flex-col items-center justify-center gap-4">
          <Loader2 className="animate-spin text-emerald-500" size={40} />
          <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Syncing Network...</p>
        </div>
      ) : filteredVendors.length === 0 ? (
        <div className="py-20 text-center bg-white rounded-[2.5rem] border border-slate-200 border-dashed">
            <Wrench className="w-12 h-12 text-slate-200 mx-auto mb-4" />
            <h3 className="text-lg font-black italic text-slate-400 uppercase">No Vendors Found</h3>
            <p className="text-xs text-slate-400 mt-1">Try adjusting your search filters.</p>
        </div>
      ) : (
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {paginatedVendors.map(vendor => (
              <div
                key={vendor.id}
                onClick={() => { if (canEditVendors) { setEditingVendor(vendor); setIsFormOpen(true) } }}
                className={`bg-white p-6 rounded-[2.5rem] border transition-all duration-300 relative group overflow-hidden flex flex-col h-full justify-between ${canEditVendors ? 'cursor-pointer' : 'cursor-default'}
                  ${vendor.do_not_use
                    ? 'border-red-100 opacity-75 bg-red-50/10'
                    : 'border-slate-200 shadow-sm hover:shadow-xl hover:border-emerald-500/50'
                  }`}
              >
                 {/* Top Row: Icon & Status */}
                 <div>
                    <div className="flex justify-between items-start mb-6">
                        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg transition-transform group-hover:scale-110
                            ${vendor.do_not_use ? 'bg-red-500' : 'bg-slate-900'}
                        `}>
                            {vendor.do_not_use ? <Ban size={24} /> : <Wrench size={24} />}
                        </div>
                        
                        {canEditVendors ? (
                          <button
                          onClick={(e) => { e.stopPropagation(); toggleStatus(vendor.id, vendor.do_not_use) }}
                          className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all hover:scale-105
                              ${vendor.do_not_use
                                  ? 'bg-red-50 text-red-600 border-red-100 hover:bg-white'
                                  : 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100'}
                          `}
                          >
                          {vendor.do_not_use ? 'Suspended' : 'Active'}
                          </button>
                        ) : (
                          <span className={`px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border
                              ${vendor.do_not_use
                                  ? 'bg-red-50 text-red-600 border-red-100'
                                  : 'bg-emerald-50 text-emerald-600 border-emerald-100'}
                          `}>
                          {vendor.do_not_use ? 'Suspended' : 'Active'}
                          </span>
                        )}
                    </div>

                    {/* Name & Contact Info */}
                    <div className="mb-6">
                        <h3 className="text-xl font-black italic text-slate-900 leading-tight mb-1 truncate">
                            {vendor.company_name || 'Independent Contractor'}
                        </h3>
                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-2">
                            <MapPin size={12} className="text-emerald-500" />
                            {vendor.contact_name || 'No Contact Listed'}
                        </p>
                    </div>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-2 mb-6">
                        <span className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 border border-blue-100">
                        <Wrench size={10} /> {vendor.trade_type || 'General'}
                        </span>
                        {vendor.hourly_rate && (
                        <span className="px-3 py-1.5 bg-emerald-50 text-emerald-600 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 border border-emerald-100">
                            <DollarSign size={10} /> ${vendor.hourly_rate}/hr
                        </span>
                        )}
                        {vendor.is_1099 && (
                        <span className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1 border border-purple-100">
                            <FileText size={10} /> 1099 On File
                        </span>
                        )}
                        {!vendor.is_1099 && (
                            <span className="px-3 py-1.5 bg-slate-100 text-slate-400 rounded-lg text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                                No Tax ID
                            </span>
                        )}
                    </div>
                 </div>

                 {/* Footer Contacts */}
                 <div className="pt-5 border-t border-slate-50 space-y-3 mt-auto">
                    {vendor.phone ? (
                        <a href={`tel:${vendor.phone}`} className="flex items-center gap-3 text-sm font-bold text-slate-600 hover:text-emerald-600 transition-colors p-2 hover:bg-slate-50 rounded-xl -mx-2">
                           <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
                                <Phone size={14} /> 
                           </div>
                           {vendor.phone}
                        </a>
                    ) : (
                        <div className="flex items-center gap-3 text-sm font-bold text-slate-300 p-2 opacity-50">
                            <Phone size={14} /> No Phone
                        </div>
                    )}

                    {vendor.email ? (
                        <a href={`mailto:${vendor.email}`} className="flex items-center gap-3 text-sm font-bold text-slate-600 hover:text-emerald-600 transition-colors p-2 hover:bg-slate-50 rounded-xl -mx-2">
                           <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400">
                                <Mail size={14} />
                           </div>
                           {vendor.email}
                        </a>
                    ) : (
                        <div className="flex items-center gap-3 text-sm font-bold text-slate-300 p-2 opacity-50">
                             <Mail size={14} /> No Email
                        </div>
                    )}
                 </div>
              </div>
           ))}
        </div>
      )}

      {/* PAGINATION */}
      {!loading && totalPages > 1 && (
        <div className="max-w-7xl mx-auto flex justify-center items-center gap-2 mt-8 pb-4">
          <button
            disabled={currentPage === 1}
            onClick={() => { setCurrentPage(p => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-emerald-500 hover:text-emerald-600 transition-all disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:text-slate-600 flex items-center gap-1"
          >
            <ChevronLeft size={14} /> Prev
          </button>

          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(page => page === 1 || page === totalPages || Math.abs(page - currentPage) <= 2)
            .reduce<(number | string)[]>((acc, page, idx, arr) => {
              if (idx > 0 && page - (arr[idx - 1] as number) > 1) acc.push('...')
              acc.push(page)
              return acc
            }, [])
            .map((item, i) =>
              typeof item === 'string' ? (
                <span key={`ellipsis-${i}`} className="px-2 text-slate-300 text-xs font-bold">...</span>
              ) : (
                <button
                  key={item}
                  onClick={() => { setCurrentPage(item); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
                  className={`w-10 h-10 rounded-xl text-xs font-black transition-all ${
                    currentPage === item
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-slate-200 text-slate-500 hover:border-emerald-500 hover:text-emerald-600'
                  }`}
                >
                  {item}
                </button>
              )
            )
          }

          <button
            disabled={currentPage === totalPages}
            onClick={() => { setCurrentPage(p => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase tracking-widest text-slate-600 hover:border-emerald-500 hover:text-emerald-600 transition-all disabled:opacity-30 disabled:hover:border-slate-200 disabled:hover:text-slate-600 flex items-center gap-1"
          >
            Next <ChevronRight size={14} />
          </button>
        </div>
      )}

      <VendorFormModal
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingVendor(null) }}
        vendor={editingVendor}
      />
    </div>
  )
}