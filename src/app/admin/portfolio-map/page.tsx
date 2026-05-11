'use client'

import React, { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { supabase } from '@/lib/supabaseClient'
import { Navigation, Loader2, ArrowLeft, TrendingUp, AlertTriangle, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN

/** Escape HTML entities to prevent XSS when injecting into DOM via innerHTML/setHTML */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export default function PortfolioMap() {
  const mapContainer = useRef<any>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ total: 0, occupied: 0, vacant: 0 })

  useEffect(() => {
    if (!MAPBOX_TOKEN) return
    mapboxgl.accessToken = MAPBOX_TOKEN

    async function initMap() {
      try {
        // 1. Fetch Properties and Units separately to avoid 400 errors
        const { data: properties, error: pError } = await supabase
          .from('properties')
          .select('id, name, city, latitude, longitude')

        // Paginate units to overcome PostgREST 1000-row default limit (1000+ units)
        let allUnits: any[] = []
        let uError: any = null
        let from = 0
        const PAGE_SIZE = 1000
        let hasMore = true
        while (hasMore) {
          const { data: batch, error } = await supabase
            .from('units')
            .select('id, property_id, status')
            .range(from, from + PAGE_SIZE - 1)
          if (error) { uError = error; break }
          allUnits = allUnits.concat(batch ?? [])
          hasMore = (batch?.length ?? 0) === PAGE_SIZE
          from += PAGE_SIZE
        }
        const units = allUnits

        if (pError || uError) {
          console.error("Supabase Sync Error:", pError || uError)
          setLoading(false)
          return
        }

        // 2. Process Data Locally
        let totalUnits = units?.length || 0
        let totalVacant = units?.filter(u => u.status?.toLowerCase() === 'vacant').length || 0
        
        const mappableProps = properties?.filter(p => p.latitude && p.longitude).map(prop => {
          const propUnits = units?.filter(u => u.property_id === prop.id) || []
          const vacancyCount = propUnits.filter(u => u.status?.toLowerCase() === 'vacant').length
          const total = propUnits.length
          
          // Health Color Logic
          let statusColor = '#10b981' // Green (Full)
          if (vacancyCount > 0) statusColor = '#f59e0b' // Yellow (Warning)
          if (vacancyCount >= 3) statusColor = '#ef4444' // Red (Critical)

          return { ...prop, vacancyCount, total, statusColor }
        }) || []

        setStats({
          total: properties?.length || 0,
          occupied: totalUnits - totalVacant,
          vacant: totalVacant
        })

        // 3. Initialize Map Engine
        if (map.current) return 
        map.current = new mapboxgl.Map({
          container: mapContainer.current,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [-119.8143, 39.5277], // Reno Center
          zoom: 11,
          pitch: 45,
        })

        map.current.on('load', () => {
          setLoading(false)
          mappableProps.forEach((prop) => {
            const el = document.createElement('div')
            el.className = 'marker-group'
            // Safe: statusColor is derived from hardcoded hex values (line 54-56), not user input.
            // Numeric values (total, vacancyCount) are safe. No user-controlled strings injected here.
            el.innerHTML = `
              <div class="relative group cursor-pointer">
                <div class="w-10 h-10 rounded-2xl border-4 border-slate-900 shadow-2xl flex items-center justify-center text-white transition-all transform group-hover:scale-125"
                     style="background-color: ${prop.statusColor}">
                  <span class="text-[9px] font-black">${prop.total - prop.vacancyCount}/${prop.total}</span>
                </div>
                ${prop.vacancyCount > 0 ? '<div class="absolute -top-1 -right-1 w-3 h-3 bg-white rounded-full border-2 border-slate-900 animate-pulse"></div>' : ''}
              </div>
            `

            new mapboxgl.Marker(el)
              .setLngLat([prop.longitude, prop.latitude])
              .setPopup(
                new mapboxgl.Popup({ offset: 30, closeButton: false })
                  .setHTML(`
                    <div class="p-5 bg-white rounded-2xl shadow-2xl border border-slate-100 min-w-[200px]">
                      <p class="font-black text-slate-900 uppercase text-[10px] tracking-widest leading-none mb-1">${escapeHtml(prop.name)}</p>
                      <p class="text-[9px] font-bold text-slate-400 uppercase mb-4">${escapeHtml(prop.city)}</p>

                      <div class="grid grid-cols-2 gap-4 mb-4 bg-slate-50 p-3 rounded-xl">
                          <div>
                              <p class="text-[7px] font-black text-slate-400 uppercase">Status</p>
                              <p class="text-[10px] font-black uppercase ${prop.vacancyCount === 0 ? 'text-emerald-600' : 'text-amber-600'}">
                                  ${prop.vacancyCount === 0 ? 'Stable' : 'Leasing'}
                              </p>
                          </div>
                          <div>
                              <p class="text-[7px] font-black text-slate-400 uppercase">Vacancy</p>
                              <p class="text-[10px] font-black text-slate-900">${prop.vacancyCount} Units</p>
                          </div>
                      </div>

                      <a href="/admin/properties/${encodeURIComponent(prop.id)}" class="block w-full text-center py-3 bg-slate-900 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all">
                        View Detailed Ledger
                      </a>
                    </div>
                  `)
              )
              .addTo(map.current!)
          })
        })
      } catch (err) {
        console.error("Critical Map Failure:", err)
        setLoading(false)
      }
    }
    initMap()
  }, [])

  return (
    <div className="h-[calc(100vh-140px)] w-full relative group p-6">
      {/* HUD OVERLAY */}
      <div className="absolute top-12 left-12 z-10 space-y-6">
        <div className="bg-slate-900/95 backdrop-blur-xl p-8 rounded-[2.5rem] border border-white/10 shadow-2xl text-white w-96">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center text-slate-900">
                <Navigation size={24} strokeWidth={3} />
            </div>
            <div>
                <h1 className="text-2xl font-black italic uppercase tracking-tighter leading-none">
                    Asset <span className="text-emerald-500">Heatmap</span>
                </h1>
                <p className="text-[8px] font-black text-slate-500 uppercase tracking-[0.3em] mt-1">Real-Time Occupancy Engine</p>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
             <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Portfolio Health</p>
                <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-500" />
                    <p className="text-xl font-black italic text-white">
                      {stats.total > 0 ? ((stats.occupied / (stats.occupied + stats.vacant)) * 100).toFixed(1) : '0'}%
                    </p>
                </div>
             </div>
             <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                <p className="text-[8px] font-black text-slate-500 uppercase mb-1">Leasing Priority</p>
                <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-500" />
                    <p className="text-xl font-black italic text-white">{stats.vacant} Units</p>
                </div>
             </div>
          </div>
        </div>
      </div>

      <div ref={mapContainer} className="w-full h-full rounded-[4rem] overflow-hidden shadow-2xl border-4 border-white bg-slate-900" />

      {loading && (
        <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-md flex flex-col items-center justify-center gap-6 z-50 rounded-[4rem]">
          <Loader2 className="animate-spin text-emerald-500" size={48} strokeWidth={3} />
          <p className="text-lg font-black text-white uppercase italic tracking-tighter">Syncing Occupancy Telemetry...</p>
        </div>
      )}

      <style jsx global>{`
        .mapboxgl-popup-content { padding: 0; background: transparent; border: none; box-shadow: none; }
        .mapboxgl-popup-tip { border-top-color: #fff !important; }
      `}</style>
    </div>
  )
}