'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Bell, UserCircle, Home, User, Loader2 } from 'lucide-react'
import { globalSearch, SearchResults } from '@/lib/search'
import Link from 'next/link'

export default function TopBar() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<SearchResults>({ properties: [], tenants: [] })
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    const handler = setTimeout(async () => {
      if (query.length >= 2) {
        setLoading(true)
        const data = await globalSearch(query)
        setResults(data)
        setIsOpen(true)
        setLoading(false)
      } else {
        setIsOpen(false)
      }
    }, 300)
    return () => clearTimeout(handler)
  }, [query])

  return (
    <header className="h-20 border-b border-slate-200 bg-white/95 backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-[100]">
      <div className="flex-1 max-w-2xl relative" ref={dropdownRef}>
        <div className="relative group">
          <Search className={`absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${isOpen ? 'text-emerald-500' : 'text-slate-400'}`} size={18} />
          <input 
            type="text" 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Reno & Carson properties or tenants..." 
            className="w-full pl-12 pr-12 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 focus:bg-white transition-all font-bold text-sm"
          />
          {loading && <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-slate-300" size={18} />}
        </div>

        {isOpen && (results.properties.length > 0 || results.tenants.length > 0) && (
          <div className="absolute top-[calc(100%+8px)] left-0 right-0 bg-white border border-slate-200 rounded-[2rem] shadow-2xl overflow-hidden z-[110] animate-in fade-in slide-in-from-top-2">
            {results.properties.map(p => (
              <Link key={p.id} href={`/admin/properties/${p.id}`} onClick={() => setIsOpen(false)} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors group border-b border-slate-50 last:border-0">
                <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-white transition-all">
                  <Home size={18} />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-900">{p.name}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">{p.city}, NV</p>
                </div>
              </Link>
            ))}
            {results.tenants.map(t => (
              <Link key={t.id} href={`/admin/tenants`} onClick={() => setIsOpen(false)} className="flex items-center gap-4 px-6 py-4 hover:bg-slate-50 transition-colors group border-b border-slate-50 last:border-0">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all">
                  <User size={18} />
                </div>
                <div>
                  <p className="text-sm font-black text-slate-900">{t.first_name} {t.last_name}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Resident</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3 pl-4 border-l border-slate-100">
           <div className="text-right hidden sm:block">
              <p className="text-xs font-black text-slate-900">Portfolio Manager</p>
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-tighter">Verified Session</p>
           </div>
           <div className="w-10 h-10 bg-slate-900 rounded-full flex items-center justify-center text-white"><UserCircle size={24} /></div>
        </div>
      </div>
    </header>
  )
}