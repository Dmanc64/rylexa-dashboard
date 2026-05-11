'use client'

import { Building2, Factory, Building, Home } from 'lucide-react'

export default function NodeMap({ properties = [] }: { properties?: any[] }) {
  // Define fixed visual positions to keep the design consistent
  const positions = [
    { top: '35%', left: '20%', icon: Building, color: 'bg-emerald-700', shadow: 'shadow-emerald-900/20' },
    { top: '55%', left: '45%', icon: Building2, color: 'bg-blue-700', shadow: 'shadow-blue-900/20' },
    { top: '70%', left: '75%', icon: Factory, color: 'bg-slate-700', shadow: 'shadow-slate-900/20' },
  ]

  // If no properties are passed (or loading), show a placeholder node
  const displayProps = properties.length > 0 ? properties.slice(0, 3) : [
    { name: 'Loading Assets...', id: 0 }
  ]

  return (
    <div className="relative w-full h-[400px] bg-slate-100 rounded-xl overflow-hidden border border-slate-200">
      
      {/* 1. Dotted Background Pattern */}
      <div className="absolute inset-0 opacity-40" 
           style={{ backgroundImage: 'radial-gradient(#94a3b8 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
      </div>

      {/* 2. Connection Lines (SVG) */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <path d="M 250 180 Q 400 250 500 280" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="5,5" />
        <path d="M 500 280 Q 650 300 750 350" fill="none" stroke="#cbd5e1" strokeWidth="2" strokeDasharray="5,5" />
      </svg>

      {/* 3. Dynamic Property Nodes */}
      {displayProps.map((prop, index) => {
        // Cycle through positions if we have more properties than positions defined
        const style = positions[index % positions.length]
        const Icon = style.icon

        return (
            <div 
                key={prop.id || index}
                className="absolute transform -translate-x-1/2 flex flex-col items-center group cursor-pointer"
                style={{ top: style.top, left: style.left }}
            >
                <div className={`w-12 h-12 ${style.color} rounded-full flex items-center justify-center text-white shadow-lg ${style.shadow} group-hover:scale-110 transition-transform`}>
                    <Icon size={20} />
                </div>
                <div className="mt-3 px-3 py-1 bg-slate-900 text-white text-xs font-bold rounded-md shadow-lg whitespace-nowrap z-10">
                    {prop.name}
                </div>
            </div>
        )
      })}

    </div>
  )
}