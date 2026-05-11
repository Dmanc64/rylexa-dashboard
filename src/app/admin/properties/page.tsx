'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { 
  Building2, MapPin, TrendingUp, AlertCircle, 
  ArrowRight, Loader2, Plus, LayoutGrid, List
} from 'lucide-react'
import { useProperties } from '@/hooks/useProperties'

export default function PropertyDirectory() {
  const { properties, loading } = useProperties()
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [filter, setFilter] = useState('All')

  // Filter Logic (City based)
  const cities = ['All', ...Array.from(new Set(properties.map(p => p.city)))]
  const filteredProps = properties.filter(p => filter === 'All' || p.city === filter)

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-4 md:p-10 animate-in fade-in">

      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-8 md:mb-10 flex flex-col md:flex-row justify-between items-start md:items-end gap-4 md:gap-6">
        <div>
          <h1 className="text-3xl md:text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
            Asset <span className="text-emerald-600">Portfolio</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
            {properties.length} Active Buildings • Reno / Carson Market
          </p>
        </div>

        <div className="flex gap-2">
           <div className="bg-white p-1 rounded-xl border border-slate-200 flex shadow-sm">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                aria-label="Grid view"
              >
                 <LayoutGrid size={18} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg transition-all ${viewMode === 'list' ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'}`}
                aria-label="List view"
              >
                 <List size={18} />
              </button>
           </div>
           <button className="px-6 py-3 bg-emerald-600 text-white font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-emerald-500 transition-all flex items-center gap-2 shadow-lg shadow-emerald-900/20">
             <Plus size={16} /> Add Asset
           </button>
        </div>
      </div>

      {/* FILTER BAR */}
      <div className="max-w-7xl mx-auto mb-8 flex gap-2 overflow-x-auto pb-2">
         {cities.map(city => (
            <button
              key={city}
              onClick={() => setFilter(city)}
              className={`px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest whitespace-nowrap transition-all border ${
                 filter === city 
                 ? 'bg-white border-emerald-500 text-emerald-600 shadow-md' 
                 : 'bg-transparent border-transparent text-slate-400 hover:bg-white hover:text-slate-600'
              }`}
            >
              {city}
            </button>
         ))}
      </div>

      {/* CONTENT AREA */}
      {loading ? (
         <div className="py-32 flex flex-col items-center justify-center gap-4">
            <Loader2 className="animate-spin text-emerald-500" size={40} />
            <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">Auditing Assets...</p>
         </div>
      ) : (
         <div className={`max-w-7xl mx-auto grid gap-6 ${viewMode === 'grid' ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
            {filteredProps.map(prop => (
               <Link key={prop.id} href={`/admin/properties/${prop.id}`} className="group">
                  <div className={`bg-white border border-slate-200 overflow-hidden shadow-sm hover:shadow-2xl hover:border-emerald-500/50 transition-all duration-500 ${viewMode === 'grid' ? 'rounded-[2.5rem] flex flex-col h-full' : 'rounded-[2rem] flex items-center p-2'}`}>
                     
                     {/* IMAGE / THUMBNAIL */}
                     <div className={`relative bg-slate-100 overflow-hidden ${viewMode === 'grid' ? 'h-48 w-full' : 'h-24 w-24 rounded-[1.5rem] shrink-0'}`}>
                        {prop.image_url ? (
                           <Image src={prop.image_url} alt={prop.name} fill className="object-cover group-hover:scale-110 transition-transform duration-700" sizes="(max-width: 768px) 100vw, 300px" />
                        ) : (
                           <div className="w-full h-full flex items-center justify-center text-slate-300">
                              <Building2 size={32} />
                           </div>
                        )}
                        {/* Status Badge (Grid Only) */}
                        {viewMode === 'grid' && (
                           <div className="absolute top-4 right-4 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest text-slate-900 shadow-sm">
                              {prop.total_units} Units
                           </div>
                        )}
                     </div>

                     {/* INFO BODY */}
                     <div className={`flex-1 ${viewMode === 'grid' ? 'p-8' : 'px-8 py-2 flex justify-between items-center'}`}>
                        
                        <div>
                           <div className="flex items-center gap-2 mb-2 text-slate-400">
                              <MapPin size={12} />
                              <span className="text-[10px] font-bold uppercase tracking-wider">{prop.city}</span>
                           </div>
                           <h3 className="text-xl font-black text-slate-900 italic uppercase leading-none mb-4 group-hover:text-emerald-600 transition-colors">
                              {prop.name}
                           </h3>
                        </div>

                        {/* METRICS ROW */}
                        <div className={`flex gap-6 ${viewMode === 'grid' ? 'border-t border-slate-50 pt-6' : ''}`}>
                           <div>
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Occupancy</p>
                              <div className="flex items-center gap-2">
                                 <div className={`text-lg font-black italic ${prop.occupancy_rate > 90 ? 'text-slate-900' : 'text-amber-500'}`}>
                                    {(prop.occupancy_rate ?? 0).toFixed(0)}%
                                 </div>
                                 {prop.occupancy_rate < 90 && <AlertCircle size={14} className="text-amber-500" />}
                              </div>
                           </div>
                           <div>
                              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Est. Revenue</p>
                              <div className="flex items-center gap-2">
                                 <div className="text-lg font-black italic text-emerald-600">
                                    ${(prop.projected_revenue ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                 </div>
                              </div>
                           </div>
                           
                           {/* List View Arrow */}
                           {viewMode === 'list' && (
                              <div className="ml-auto flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-50 text-slate-300 group-hover:bg-slate-900 group-hover:text-white transition-colors">
                                 <ArrowRight size={20} />
                              </div>
                           )}
                        </div>
                     </div>
                  </div>
               </Link>
            ))}
         </div>
      )}
    </div>
  )
}