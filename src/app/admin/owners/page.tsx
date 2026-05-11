'use client'

import { useState } from 'react'
import {
  Building2, Mail, Phone, Plus, Search,
  Loader2, Users2, ArrowRight, Briefcase
} from 'lucide-react'
import { useOwners, type Owner } from '@/hooks/useOwners'
import OwnerFormModal from '@/components/OwnerFormModal'

const OWNERS_PER_PAGE = 12

export default function OwnersPage() {
  const { owners, loading } = useOwners()
  const [search, setSearch] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingOwner, setEditingOwner] = useState<Owner | null>(null)

  // Filter by search
  const filtered = owners.filter(o => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      o.full_name.toLowerCase().includes(q) ||
      o.email.toLowerCase().includes(q) ||
      (o.company_name || '').toLowerCase().includes(q) ||
      (o.phone || '').includes(q)
    )
  })

  // Pagination
  const totalPages = Math.ceil(filtered.length / OWNERS_PER_PAGE)
  const paginated = filtered.slice(
    (currentPage - 1) * OWNERS_PER_PAGE,
    currentPage * OWNERS_PER_PAGE
  )

  const openCreate = () => {
    setEditingOwner(null)
    setIsFormOpen(true)
  }

  const openEdit = (owner: Owner) => {
    setEditingOwner(owner)
    setIsFormOpen(true)
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">

      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-10 flex flex-col md:flex-row justify-between items-end gap-6">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
            Owner <span className="text-emerald-600">Registry</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
            {owners.length} Registered Owner{owners.length !== 1 ? 's' : ''}
          </p>
        </div>

        <button
          onClick={openCreate}
          className="px-6 py-3 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-500 transition-all flex items-center gap-2 shadow-lg shadow-emerald-900/20"
        >
          <Plus size={16} /> Add Owner
        </button>
      </div>

      {/* SEARCH BAR */}
      <div className="max-w-7xl mx-auto mb-8">
        <div className="relative max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={18} />
          <input
            type="text"
            placeholder="Search owners by name, email, or company..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setCurrentPage(1) }}
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 transition-all shadow-sm"
          />
        </div>
      </div>

      {/* CONTENT */}
      {loading ? (
        <div className="py-32 flex flex-col items-center justify-center gap-4">
          <Loader2 className="animate-spin text-emerald-500" size={40} />
          <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Loading Owners...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-32 flex flex-col items-center justify-center gap-4">
          <Users2 className="text-slate-300" size={48} />
          <p className="text-slate-400 font-bold text-sm">
            {search ? 'No owners match your search' : 'No owners registered yet'}
          </p>
          {!search && (
            <button
              onClick={openCreate}
              className="mt-2 px-6 py-3 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-500 transition-all flex items-center gap-2"
            >
              <Plus size={16} /> Add First Owner
            </button>
          )}
        </div>
      ) : (
        <>
          {/* OWNER CARDS GRID */}
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {paginated.map(owner => (
              <div
                key={owner.id}
                onClick={() => openEdit(owner)}
                className="bg-white border border-slate-200 rounded-[2rem] p-8 shadow-sm hover:shadow-2xl hover:border-emerald-500/50 transition-all duration-500 cursor-pointer group"
              >
                {/* Top Row: Avatar + Name */}
                <div className="flex items-start gap-4 mb-6">
                  <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center shrink-0 group-hover:bg-emerald-100 transition-colors">
                    <Users2 size={20} className="text-emerald-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-black text-slate-900 italic uppercase leading-tight truncate group-hover:text-emerald-600 transition-colors">
                      {owner.full_name}
                    </h3>
                    {owner.company_name && (
                      <div className="flex items-center gap-1.5 mt-1 text-slate-400">
                        <Briefcase size={11} />
                        <span className="text-[10px] font-bold uppercase tracking-wider truncate">{owner.company_name}</span>
                      </div>
                    )}
                  </div>
                  <div className="ml-auto flex items-center justify-center w-10 h-10 rounded-xl bg-slate-50 text-slate-300 group-hover:bg-slate-900 group-hover:text-white transition-colors shrink-0">
                    <ArrowRight size={16} />
                  </div>
                </div>

                {/* Contact Info */}
                <div className="space-y-2 mb-6">
                  <div className="flex items-center gap-2 text-slate-500">
                    <Mail size={13} className="text-slate-300 shrink-0" />
                    <span className="text-xs font-bold truncate">{owner.email}</span>
                  </div>
                  {owner.phone && (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Phone size={13} className="text-slate-300 shrink-0" />
                      <span className="text-xs font-bold">{owner.phone}</span>
                    </div>
                  )}
                </div>

                {/* Properties Count Badge */}
                <div className="flex items-center gap-2 pt-4 border-t border-slate-50">
                  <Building2 size={14} className="text-emerald-500" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                    {owner.property_count} {owner.property_count === 1 ? 'Property' : 'Properties'}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* PAGINATION */}
          {totalPages > 1 && (
            <div className="max-w-7xl mx-auto mt-10 flex justify-center gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-10 h-10 rounded-xl text-xs font-black transition-all ${
                    page === currentPage
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'bg-white text-slate-400 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {page}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* MODAL */}
      <OwnerFormModal
        isOpen={isFormOpen}
        onClose={() => { setIsFormOpen(false); setEditingOwner(null) }}
        owner={editingOwner}
      />
    </div>
  )
}
