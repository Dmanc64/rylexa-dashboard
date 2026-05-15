'use client'

import { useState } from 'react'
import {
  CheckCircle, XCircle, User, Briefcase,
  Calendar, Loader2, FileText, Search, ShieldCheck, ShieldOff, Flag
} from 'lucide-react'
import Link from 'next/link'
import { useApplications, Application } from '@/hooks/useApplications'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import TenantBuildModal from '@/components/TenantBuildModal'
import ScreeningPanel from '@/components/ScreeningPanel'
import { supabase } from '@/lib/supabaseClient'
import { toast } from 'sonner'

export default function ApplicationsConsole() {
  const { applications, loading, processing, processApplication, preapproveApplication, refresh } = useApplications()
  const { isEnabled } = useFeatureFlags()
  const [selectedApp, setSelectedApp] = useState<Application | null>(null)
  const [filter, setFilter] = useState('Pending')
  const [buildApp, setBuildApp] = useState<Application | null>(null)
  const [search, setSearch] = useState('')
  const [waiving, setWaiving] = useState(false)

  const screeningEnabled = isEnabled('tenant_screening')

  // Filter Logic
  const filteredApps = applications.filter(a => {
    if (filter !== 'All' && a.status !== filter) return false
    if (search) {
      const term = search.toLowerCase()
      const matchName = `${a.first_name} ${a.last_name}`.toLowerCase().includes(term)
      const matchEmail = a.email?.toLowerCase().includes(term)
      const matchProperty = a.property_name?.toLowerCase().includes(term)
      const matchUnit = a.unit_name?.toLowerCase().includes(term)
      if (!matchName && !matchEmail && !matchProperty && !matchUnit) return false
    }
    return true
  })

  // Risk Calc Helper
  const getRiskScore = (income: number) => {
    if (income < 3500) return { label: 'High Risk', color: 'text-red-500 bg-red-50' }
    if (income < 5500) return { label: 'Moderate', color: 'text-amber-500 bg-amber-50' }
    return { label: 'Qualified', color: 'text-emerald-600 bg-emerald-50' }
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 p-6 md:p-10 animate-in fade-in">
      
      {/* HEADER */}
      <div className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row justify-between items-end gap-4">
        <div>
          <h1 className="text-4xl font-black italic tracking-tighter text-slate-900 uppercase">
            Applicant <span className="text-emerald-600">Pipeline</span>
          </h1>
          <p className="text-slate-500 font-bold text-[10px] tracking-[0.2em] mt-2 uppercase">
            {applications.filter(a => a.status === 'Pending').length} Pending
            {' · '}
            {applications.filter(a => a.status === 'Preapproved').length} In CRM
          </p>
        </div>
        
        {/* Filter Toggle */}
        <div className="bg-white p-1 rounded-xl border border-slate-200 flex shadow-sm">
           {['Pending', 'Preapproved', 'Approved', 'Denied', 'All'].map(f => (
             <button
               key={f}
               onClick={() => { setFilter(f); setSelectedApp(null); }}
               className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
                 filter === f ? 'bg-slate-900 text-white shadow-md' : 'text-slate-400 hover:text-slate-600'
               }`}
             >
               {f}
             </button>
           ))}
        </div>
      </div>

      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8 h-[calc(100vh-240px)] min-h-[600px]">
        
        {/* LEFT COLUMN: LIST */}
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden flex flex-col">
           <div className="p-6 border-b border-slate-50 bg-slate-50/50">
              <div className="relative">
                 <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                 <input
                   placeholder="Search applicants..."
                   value={search}
                   onChange={(e) => setSearch(e.target.value)}
                   className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-emerald-500/20"
                 />
              </div>
           </div>
           
           <div className="overflow-y-auto flex-1 p-4 space-y-2">
              {loading ? (
                <div className="py-10 text-center"><Loader2 className="animate-spin mx-auto text-emerald-500" /></div>
              ) : filteredApps.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-xs font-bold uppercase">No {filter} Applications</div>
              ) : (
                filteredApps.map(app => (
                  <div 
                    key={app.id}
                    onClick={() => setSelectedApp(app)}
                    className={`p-5 rounded-2xl cursor-pointer transition-all border ${
                      selectedApp?.id === app.id 
                      ? 'bg-slate-900 text-white border-slate-900 shadow-lg scale-[1.02]' 
                      : 'bg-white hover:bg-slate-50 border-slate-100 text-slate-900'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                       <h3 className="font-black italic text-lg">{app.first_name} {app.last_name}</h3>
                       <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${
                          app.status === 'Pending' ? 'bg-amber-100 text-amber-600 border-amber-200' :
                          app.status === 'Preapproved' ? 'bg-indigo-100 text-indigo-600 border-indigo-200' :
                          app.status === 'Approved' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' :
                          'bg-red-100 text-red-600 border-red-200'
                       }`}>
                         {app.status}
                       </span>
                    </div>
                    <p className={`text-xs font-bold ${selectedApp?.id === app.id ? 'text-slate-400' : 'text-slate-500'}`}>
                      {app.property_name} • {app.unit_name}
                    </p>
                    <Link
                      href={`/admin/applications/${app.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className={`mt-2 inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-widest transition-colors ${
                        selectedApp?.id === app.id
                          ? 'text-emerald-300 hover:text-emerald-200'
                          : 'text-emerald-600 hover:text-emerald-700'
                      }`}
                    >
                      Full Details →
                    </Link>
                  </div>
                ))
              )}
           </div>
        </div>

        {/* RIGHT COLUMN: DETAILS */}
        <div className="lg:col-span-2 h-full">
          {selectedApp ? (
            <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm h-full flex flex-col relative overflow-hidden animate-in fade-in slide-in-from-right-4">
               
               {/* Detail Header */}
               <div className="p-10 border-b border-slate-100 bg-slate-50/30 flex justify-between items-start">
                  <div className="flex gap-6 items-center">
                     <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 border border-slate-200">
                        <User size={40} />
                     </div>
                     <div>
                        <h2 className="text-3xl font-black text-slate-900 italic uppercase">{selectedApp.first_name} {selectedApp.last_name}</h2>
                        <div className="flex gap-4 mt-2">
                           <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                              <Briefcase size={14} /> {selectedApp.employer}
                           </div>
                           <div className="flex items-center gap-1.5 text-xs font-bold text-slate-500">
                              <Calendar size={14} /> Applied: {new Date(selectedApp.created_at).toLocaleDateString()}
                           </div>
                        </div>
                     </div>
                  </div>
                  
                  <div className="flex flex-col items-end gap-2">
                    {/* Risk / Screening Badge */}
                    {screeningEnabled && selectedApp.screening_status === 'Screened' && selectedApp.screening_score != null ? (
                      <div className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-1.5 ${
                        selectedApp.screening_score >= 70 ? 'text-emerald-600 bg-emerald-50' :
                        selectedApp.screening_score >= 50 ? 'text-amber-500 bg-amber-50' :
                        'text-red-500 bg-red-50'
                      }`}>
                         <ShieldCheck size={14} /> {selectedApp.screening_score}/100
                      </div>
                    ) : (
                      <div className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest ${getRiskScore(selectedApp.income).color}`}>
                         {getRiskScore(selectedApp.income).label}
                      </div>
                    )}
                    <Link
                      href={`/admin/applications/${selectedApp.id}`}
                      className="text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700"
                    >
                      Full Details →
                    </Link>
                  </div>
               </div>

               {/* Detail Body */}
               <div className="p-10 space-y-8 overflow-y-auto flex-1">
                  <div className="grid grid-cols-2 gap-8">
                     <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Monthly Income ($)</p>
                        <p className="text-3xl font-black text-slate-900 italic">${selectedApp.income?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                     </div>
                     <div className="p-6 bg-slate-50 rounded-2xl border border-slate-100">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Credit Score</p>
                        <p className="text-3xl font-black text-slate-900 italic">{selectedApp.credit_score || 'N/A'}</p>
                     </div>
                  </div>

                  {/* Screening Panel */}
                  {screeningEnabled && selectedApp.status === 'Pending' && (
                    <ScreeningPanel
                      application={selectedApp}
                      onScored={() => {
                        refresh()
                        // Re-select the updated app after refresh
                        setTimeout(() => {
                          setSelectedApp(prev => prev ? { ...prev, screening_status: 'Screened' as const } : null)
                        }, 500)
                      }}
                    />
                  )}

                  <div className="space-y-4">
                     <h3 className="text-sm font-black text-slate-900 uppercase flex items-center gap-2 border-b border-slate-100 pb-2">
                        <FileText size={16} /> Application Details
                     </h3>
                     <div className="grid grid-cols-2 gap-y-6 text-sm">
                        <div>
                            <span className="block text-[10px] font-black text-slate-400 uppercase">Email Contact</span>
                            <span className="font-bold text-slate-900">{selectedApp.email}</span>
                        </div>
                        <div>
                            <span className="block text-[10px] font-black text-slate-400 uppercase">Phone Number</span>
                            <span className="font-bold text-slate-900">{selectedApp.phone}</span>
                        </div>
                        <div>
                            <span className="block text-[10px] font-black text-slate-400 uppercase">Requested Unit</span>
                            <span className="font-bold text-slate-900">{selectedApp.unit_name}</span>
                        </div>
                        <div>
                            <span className="block text-[10px] font-black text-slate-400 uppercase">Target Property</span>
                            <span className="font-bold text-slate-900">{selectedApp.property_name}</span>
                        </div>
                     </div>
                  </div>
               </div>

               {/* Action Footer — available for Pending and Preapproved */}
               {(selectedApp.status === 'Pending' || selectedApp.status === 'Preapproved') && (() => {
                  const isPending = selectedApp.status === 'Pending'
                  const needsScreening = screeningEnabled &&
                    selectedApp.screening_status !== 'Screened' &&
                    selectedApp.screening_status !== 'Waived'
                  const approveDisabled = processing || needsScreening

                  return (
                    <div className="p-8 border-t border-slate-100 bg-slate-50 space-y-3">
                      {needsScreening && (
                        <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                          <p className="text-xs font-bold text-amber-700">Screening required before approval</p>
                          <button
                            onClick={async () => {
                              setWaiving(true)
                              const { error } = await supabase
                                .from('applications')
                                .update({ screening_status: 'Waived' })
                                .eq('id', selectedApp.id)
                              if (error) {
                                toast.error('Failed to waive: ' + error.message)
                              } else {
                                toast.success('Screening waived')
                                refresh()
                                setSelectedApp(prev => prev ? { ...prev, screening_status: 'Waived' as const } : null)
                              }
                              setWaiving(false)
                            }}
                            disabled={waiving}
                            className="text-[10px] font-bold text-amber-600 hover:text-amber-800 flex items-center gap-1 transition-colors"
                          >
                            {waiving ? <Loader2 size={12} className="animate-spin" /> : <ShieldOff size={12} />}
                            Waive Screening
                          </button>
                        </div>
                      )}

                      {/* Preapproved-state banner with a jump-to-CRM link */}
                      {!isPending && (
                        <div className="flex items-center justify-between bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5">
                          <p className="text-xs font-bold text-indigo-700">In Leasing CRM — ready for approval when you are.</p>
                          <Link
                            href="/admin/leasing-crm"
                            className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                          >
                            <Flag size={12} /> View in CRM
                          </Link>
                        </div>
                      )}

                      <div className="flex gap-3">
                        <button
                          onClick={() => processApplication(selectedApp.id, 'Denied')}
                          disabled={processing}
                          className="flex-1 py-4 bg-white border-2 border-slate-200 text-slate-400 font-black rounded-xl hover:border-red-500 hover:text-red-500 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs"
                        >
                          <XCircle size={18} /> Reject
                        </button>
                        {isPending && (
                          <button
                            onClick={async () => {
                              const result = await preapproveApplication(selectedApp.id)
                              if (result) {
                                setSelectedApp(prev => prev ? { ...prev, status: 'Preapproved' as const } : null)
                                toast.success(result.message, {
                                  action: result.leadId
                                    ? { label: 'View in CRM', onClick: () => { window.location.href = '/admin/leasing-crm' } }
                                    : undefined,
                                })
                              }
                            }}
                            disabled={processing}
                            className="flex-1 py-4 bg-white border-2 border-indigo-200 text-indigo-600 font-black rounded-xl hover:bg-indigo-50 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Flag size={16} /> Preapprove
                          </button>
                        )}
                        <button
                          onClick={() => setBuildApp(selectedApp)}
                          disabled={approveDisabled}
                          className="flex-[2] py-4 bg-slate-900 text-white font-black rounded-xl hover:bg-emerald-600 transition-all flex items-center justify-center gap-2 shadow-xl uppercase tracking-widest text-xs disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-slate-900"
                        >
                          <CheckCircle size={18} />
                          Approve & Create Tenant
                        </button>
                      </div>
                    </div>
                  )
               })()}
            </div>
          ) : (
            <div className="h-full bg-slate-50 rounded-[2.5rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 gap-4">
               <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center text-slate-300">
                  <User size={32} />
               </div>
               <p className="font-bold italic uppercase tracking-wider">Select an applicant to review</p>
            </div>
          )}
        </div>

      </div>

      {/* Tenant Build Modal */}
      <TenantBuildModal
        isOpen={!!buildApp}
        onClose={() => setBuildApp(null)}
        onSuccess={() => { refresh(); setSelectedApp(null); setBuildApp(null); }}
        application={buildApp}
      />
    </div>
  )
}