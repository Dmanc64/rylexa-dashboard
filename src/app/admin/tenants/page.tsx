'use client'

import { useState, useEffect } from 'react'
import { Users, UserPlus, Search, Loader2, Mail, Phone, Building2, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTenants, type Tenant } from '@/hooks/useTenants'
import Pagination from '@/components/Pagination'

export default function TenantsPage() {
  const router = useRouter()
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('Active')

  // Debounce search input (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Reset to page 0 when filters change
  useEffect(() => {
    setPage(0)
  }, [statusFilter, debouncedSearch])

  const { tenants, totalCount, counts, pageSize, loading } = useTenants(page, statusFilter, debouncedSearch)

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 animate-in fade-in">

      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h1 className="text-4xl font-black italic uppercase text-slate-900">
            Resident <span className="text-emerald-600">Directory</span>
          </h1>
          <p className="text-slate-400 font-bold text-xs uppercase tracking-widest mt-2">
            {counts.active} Active Households
          </p>
        </div>
        <Link href="/admin/leases">
          <button className="px-6 py-3 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-all flex items-center gap-2">
            <UserPlus size={16} /> Onboard Resident
          </button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Search by name, email, or property..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-12 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
          />
        </div>
        <div className="flex gap-2">
          {['All', 'Active', 'Past', 'Lead'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-4 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                statusFilter === s
                  ? 'bg-slate-900 text-white'
                  : 'bg-white border border-slate-200 text-slate-500 hover:border-slate-300'
              }`}
            >
              {s} ({s === 'All' ? counts.all : s === 'Active' ? counts.active : s === 'Past' ? counts.past : counts.lead})
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
          <Loader2 className="animate-spin text-emerald-500 mx-auto mb-4" size={32} />
          <p className="text-slate-400 text-sm font-medium">Loading residents...</p>
        </div>
      ) : tenants.length === 0 ? (
        <div className="bg-white p-12 rounded-[2.5rem] border border-slate-200 text-center shadow-sm">
          <div className="w-16 h-16 bg-slate-50 text-slate-300 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Users size={32} />
          </div>
          <h3 className="text-xl font-black text-slate-900 italic uppercase">
            {search || statusFilter !== 'All' ? 'No Matching Residents' : 'No Residents Yet'}
          </h3>
          <p className="text-slate-400 text-sm font-medium mt-2 max-w-md mx-auto">
            {search || statusFilter !== 'All'
              ? 'Try adjusting your search or filter criteria.'
              : 'Use the "Onboard Resident" button to add your first tenant.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden shadow-sm">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-400 border-b border-slate-100">
              <tr>
                <th className="px-8 py-5">Resident</th>
                <th className="px-8 py-5">Property / Unit</th>
                <th className="px-8 py-5">Contact</th>
                <th className="px-8 py-5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tenants.map((tenant) => (
                <tr
                  key={tenant.id}
                  onClick={() => router.push(`/tenants/${tenant.id}`)}
                  className="hover:bg-slate-50 transition-colors group cursor-pointer"
                >
                  <td className="px-8 py-6">
                    <p className="font-black text-slate-900 group-hover:text-emerald-600 transition-colors">{tenant.first_name} {tenant.last_name}</p>
                    <p className="text-[10px] text-slate-400 font-medium">{tenant.lease_status || 'No Lease'}</p>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <Building2 size={14} className="text-slate-400" />
                      <span className="font-bold">{tenant.property_name}</span>
                      <span className="text-slate-300">&bull;</span>
                      <span>{tenant.unit_name}</span>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="space-y-1">
                      {tenant.email && (
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Mail size={12} /> {tenant.email}
                        </div>
                      )}
                      {tenant.phone && (
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <Phone size={12} /> {tenant.phone}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <span className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${
                        tenant.status === 'Active'
                          ? 'bg-emerald-50 text-emerald-600'
                          : tenant.status === 'Past'
                          ? 'bg-slate-100 text-slate-500'
                          : 'bg-blue-50 text-blue-600'
                      }`}>
                        {tenant.status}
                      </span>
                      <ChevronRight size={16} className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-6 border-t border-slate-100">
            <Pagination page={page} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} />
          </div>
        </div>
      )}
    </div>
  )
}
