'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Search, User, Wrench, Home, Loader2, X, ArrowRight } from 'lucide-react'

// --- TYPES ---
type SearchResult = {
  id: string
  type: 'tenant' | 'ticket' | 'unit'
  title: string
  subtitle: string
  url: string
}

export default function GlobalSearchBar() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Close dropdown if clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // The Search Logic
  useEffect(() => {
    let cancelled = false

    const delayDebounceFn = setTimeout(async () => {
      if (query.length < 2) {
        setResults([])
        return
      }

      setLoading(true)
      setOpen(true)

      // Sanitize search input to prevent PostgREST filter injection
      const escaped = query.replace(/[%_,.()"\\\\\\/;|]/g, '')
      if (!escaped) { setLoading(false); return }

      // Parallel search across all 3 tables
      const [tenantRes, unitRes, ticketRes] = await Promise.all([
        supabase
          .from('tenants')
          .select('id, first_name, last_name, email')
          .or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%`)
          .limit(3),
        supabase
          .from('units')
          .select('id, name')
          .ilike('name', `%${escaped}%`)
          .limit(2),
        supabase
          .from('work_orders')
          .select('id, title, status')
          .ilike('title', `%${escaped}%`)
          .limit(2),
      ])

      // Prevent state update if component unmounted or query changed
      if (cancelled) return

      const finalResults: SearchResult[] = []

      if (tenantRes.data) {
        tenantRes.data.forEach(t => finalResults.push({
          id: t.id,
          type: 'tenant',
          title: `${t.first_name} ${t.last_name}`,
          subtitle: t.email,
          url: `/admin/tenants`
        }))
      }

      if (unitRes.data) {
        unitRes.data.forEach(u => finalResults.push({
          id: u.id,
          type: 'unit',
          title: `Unit ${u.name}`,
          subtitle: 'Property Unit',
          url: `/admin/leases`
        }))
      }

      if (ticketRes.data) {
        ticketRes.data.forEach(t => finalResults.push({
          id: t.id,
          type: 'ticket',
          title: t.title,
          subtitle: `Ticket: ${t.status}`,
          url: `/admin/maintenance`
        }))
      }

      setResults(finalResults)
      setLoading(false)
    }, 300)

    return () => { cancelled = true; clearTimeout(delayDebounceFn) }
  }, [query])

  const handleSelect = (url: string) => {
    setOpen(false)
    setQuery('')
    router.push(url)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
        setOpen(false)
        router.push(`/admin/tenants`)
    }
  }

  return (
    <div ref={wrapperRef} className="relative w-full max-w-2xl group z-30" role="search" aria-label="Global search">
        {/* NEW LAYOUT: Flex container. 
           'items-center' guarantees perfectly centered vertical alignment between icon and text.
        */}
        <div className="flex items-center w-full bg-white border border-slate-200 rounded-2xl 
            shadow-[0_2px_12px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)] hover:border-slate-300
            focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:border-blue-500/50
            transition-all duration-200 overflow-hidden">
            
            {/* ICON CONTAINER (Left Side) */}
            <div className="pl-5 pr-3 text-slate-400 group-focus-within:text-blue-600 transition-colors duration-200 flex items-center justify-center">
                <Search className="w-6 h-6" strokeWidth={2.5} />
            </div>
            
            {/* INPUT (Fills remaining space) */}
            <input
                type="text"
                className="flex-1 py-4 bg-transparent outline-none text-lg font-medium text-slate-800 placeholder:text-slate-400"
                placeholder="Search tenants, units, or repairs..."
                aria-label="Search tenants, units, or repairs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => { if(results.length > 0) setOpen(true) }}
            />
            
            {/* CLEAR BUTTON (Right Side) */}
            {query && (
                <button
                    onClick={() => { setQuery(''); setResults([]); setOpen(false) }}
                    className="pr-5 pl-3 text-slate-300 hover:text-slate-600 transition-all flex items-center justify-center"
                    aria-label="Clear search"
                >
                    <X size={20} />
                </button>
            )}
        </div>

        {/* DROPDOWN RESULTS */}
        {open && (results.length > 0 || loading) && (
            <div className="absolute top-full left-0 right-0 mt-3 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[500px] overflow-y-auto" role="listbox" aria-label="Search results">
                {loading ? (
                    <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-3 text-sm font-medium">
                        <Loader2 className="animate-spin w-5 h-5" /> Searching...
                    </div>
                ) : (
                    <div className="py-2">
                        {results.length > 0 ? (
                            <ul>
                                {results.map((res) => (
                                    <li 
                                        key={res.id} 
                                        onClick={() => handleSelect(res.url)}
                                        className="px-6 py-4 hover:bg-slate-50 cursor-pointer flex items-center justify-between gap-4 transition-colors group border-b border-slate-50 last:border-0"
                                    >
                                        <div className="flex items-center gap-4">
                                            <div className={`p-3 rounded-xl transition-colors shadow-sm ${
                                                res.type === 'tenant' ? 'bg-blue-50 text-blue-600 group-hover:bg-blue-100' :
                                                res.type === 'ticket' ? 'bg-orange-50 text-orange-600 group-hover:bg-orange-100' : 
                                                'bg-slate-100 text-slate-600 group-hover:bg-slate-200'
                                            }`}>
                                                {res.type === 'tenant' && <User size={20} />}
                                                {res.type === 'ticket' && <Wrench size={20} />}
                                                {res.type === 'unit' && <Home size={20} />}
                                            </div>
                                            <div>
                                                <div className="text-base font-bold text-slate-800 group-hover:text-blue-700 transition-colors">{res.title}</div>
                                                <div className="text-sm text-slate-400 font-medium">{res.subtitle}</div>
                                            </div>
                                        </div>
                                        
                                        <ArrowRight size={18} className="text-slate-300 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="p-8 text-center text-slate-400 text-sm font-medium">
                                No results found. Press <span className="font-bold text-slate-600">Enter</span> to search directory.
                            </div>
                        )}
                    </div>
                )}
            </div>
        )}
    </div>
  )
}