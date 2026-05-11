'use client'

import { useState } from 'react'
import { AlertTriangle, UserPlus } from 'lucide-react'

export function TenantDuplicationWarning({ existingTenant }: { existingTenant: any }) {
  if (!existingTenant) return null

  return (
    <div className="bg-amber-50 border border-amber-200 p-6 rounded-[1.5rem] flex gap-4 animate-in slide-in-from-left duration-300">
      <div className="w-12 h-12 bg-amber-500 text-white rounded-2xl flex items-center justify-center shrink-0">
        <AlertTriangle size={24} />
      </div>
      <div>
        <h4 className="font-black text-amber-900 italic uppercase text-xs tracking-widest">Duplicate Warning</h4>
        <p className="text-sm text-amber-800 font-medium mt-1">
          A tenant named <span className="font-black">{existingTenant.first_name} {existingTenant.last_name}</span> already exists in the Rylexa directory. 
        </p>
        <div className="flex gap-3 mt-4">
           <button className="px-4 py-2 bg-amber-500 text-white text-[10px] font-black rounded-lg hover:bg-amber-600">VIEW EXISTING RECORD</button>
           <button className="px-4 py-2 bg-white border border-amber-200 text-amber-900 text-[10px] font-black rounded-lg">IGNORE & CREATE NEW</button>
        </div>
      </div>
    </div>
  )
}