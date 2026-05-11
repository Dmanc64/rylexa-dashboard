'use client'

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import Image from 'next/image'
import {
  Wrench, CheckCircle, Clock, MapPin,
  Phone, AlertTriangle, ChevronRight, Loader2, LogOut,
  ThumbsUp, XCircle,
  Camera, MessageSquare, ChevronDown, ChevronUp, Send, DollarSign,
  Gavel, Star, CalendarDays, FileText, Upload
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { respondToWorkOrder, submitVendorUpdate } from '@/actions/vendor-actions'
import { submitBid, withdrawBid } from '@/actions/vendor-bid-actions'
import { submitInvoice } from '@/actions/vendor-invoice-actions'
import { compressImage } from '@/lib/compress-image'

// --- TYPES ---
type WorkOrder = {
  id: string
  title: string
  description: string
  priority: string
  status: string
  created_at: string
  unit_name: string
  property_name: string
  notes: string
  category?: string
}

type BiddableJob = {
  id: string
  title: string
  description: string
  priority: string
  category: string | null
  created_at: string
  unit_name: string
  property_name: string
}

type MyBid = {
  id: string
  work_order_id: string
  bid_amount: number
  estimated_hours: number | null
  proposed_start: string | null
  notes: string | null
  status: string
}

type MyInvoice = {
  id: string
  work_order_id: string
  amount: number
  status: string
}

type UpdateLog = {
  id: string
  note: string
  image_url: string | null
  created_at: string
  profiles: { full_name: string } | null
}

type VendorPerf = {
  avg_rating: number | null
  total_completed_jobs: number
  review_count: number
}

export default function VendorPortalPage() {
  const router = useRouter()
  const [jobs, setJobs] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [vendorName, setVendorName] = useState<string>('')
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)
  const [jobLogs, setJobLogs] = useState<Record<string, UpdateLog[]>>({})
  const [submittingUpdate, setSubmittingUpdate] = useState(false)
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [vendorRate, setVendorRate] = useState<number | null>(null)

  // Upgrade state
  const [upgradeEnabled, setUpgradeEnabled] = useState(false)
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'jobs' | 'bids'>('jobs')
  const [biddableJobs, setBiddableJobs] = useState<BiddableJob[]>([])
  const [myBids, setMyBids] = useState<MyBid[]>([])
  const [myInvoices, setMyInvoices] = useState<MyInvoice[]>([])
  const [submittingBid, setSubmittingBid] = useState<string | null>(null)
  const [submittingInvoice, setSubmittingInvoice] = useState<string | null>(null)
  const [performance, setPerformance] = useState<VendorPerf | null>(null)
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  useEffect(() => {
    fetchJobs()
  }, [])

  async function fetchJobs() {
    setLoading(true)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    const userEmail = user.email
    if (!userEmail) { setLoading(false); return }

    // Check feature flag
    const flagRes = await supabase.from('feature_flags').select('value').eq('key', 'vendor_portal_upgrade').single()
    const isUpgradeOn = flagRes.data?.value === true
    setUpgradeEnabled(isUpgradeOn)

    const [profileRes, vendorRes] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
      supabase.from('vendors').select('id, hourly_rate, trade_type').ilike('email', userEmail).maybeSingle(),
    ])

    setVendorName(profileRes.data?.full_name || userEmail || 'Vendor')

    const vendor = vendorRes.data
    if (!vendor) { setLoading(false); return }
    setVendorRate(vendor.hourly_rate)
    setVendorId(vendor.id)

    // Fetch assigned work orders
    const { data } = await supabase
      .from('work_orders')
      .select(`*, units (name, properties(name))`)
      .eq('vendor_id', vendor.id)
      .neq('status', 'Closed')
      .order('priority', { ascending: false })

    if (data) {
      const formatted = data.map((t: any) => ({
        ...t,
        unit_name: t.units?.name || 'General',
        property_name: t.units?.properties?.name || 'Common Area'
      }))
      setJobs(formatted)
    }

    // Upgrade: fetch biddable jobs, my bids, my invoices, performance
    if (isUpgradeOn) {
      const [biddableRes, bidsRes, invoicesRes, perfRes] = await Promise.all([
        supabase
          .from('work_orders')
          .select('id, title, description, priority, category, created_at, units ( name, properties ( name ) )')
          .eq('status', 'Open')
          .eq('bidding_open', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('vendor_bids')
          .select('id, work_order_id, bid_amount, estimated_hours, proposed_start, notes, status')
          .eq('vendor_id', vendor.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('vendor_invoices')
          .select('id, work_order_id, amount, status')
          .eq('vendor_id', vendor.id),
        supabase
          .from('vendor_performance_summary')
          .select('avg_rating, total_completed_jobs, review_count')
          .eq('vendor_id', vendor.id)
          .single(),
      ])

      if (biddableRes.data) {
        setBiddableJobs(biddableRes.data.map((j: any) => ({
          id: j.id, title: j.title, description: j.description,
          priority: j.priority, category: j.category, created_at: j.created_at,
          unit_name: j.units?.name || 'General',
          property_name: j.units?.properties?.name || 'Common Area',
        })))
      }
      if (bidsRes.data) setMyBids(bidsRes.data as MyBid[])
      if (invoicesRes.data) setMyInvoices(invoicesRes.data as MyInvoice[])
      if (perfRes.data) setPerformance(perfRes.data as VendorPerf)
    }

    setLoading(false)
  }

  // ACCEPT or REJECT an assigned work order
  const handleResponse = async (jobId: string, action: 'accept' | 'reject') => {
    setUpdatingId(jobId)
    try {
      const result = await respondToWorkOrder(jobId, action)
      if (result.success) {
        toast.success(action === 'accept' ? 'Job accepted!' : 'Job rejected')
        await fetchJobs()
      } else {
        toast.error(result.message)
      }
    } catch (err: any) {
      toast.error('Failed: ' + (err.message || 'Unknown error'))
    }
    setUpdatingId(null)
  }

  // MARK COMPLETED
  const completeJob = async (jobId: string) => {
    setUpdatingId(jobId)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { toast.error('Session expired.'); setUpdatingId(null); return }

    const { error } = await supabase
      .from('work_orders')
      .update({ status: 'Completed', notes: 'Completed via Vendor Mobile Portal' })
      .eq('id', jobId)

    if (error) {
      toast.error("Update failed: " + error.message)
    } else {
      const completedJob = jobs.find(j => j.id === jobId)
      await supabase.from('system_activity').insert({
        event_type: 'VENDOR_COMPLETED',
        title: 'Work Order Completed',
        description: `${vendorName} completed: ${completedJob?.title || 'Work Order'}`,
        actor_name: vendorName,
        related_entity_id: jobId,
      })
      setJobs(prev => prev.filter(j => j.id !== jobId))
      toast.success('Job marked as completed')
    }
    setUpdatingId(null)
  }

  // FETCH UPDATE LOGS
  const fetchJobLogs = async (jobId: string) => {
    const { data } = await supabase
      .from('work_order_updates')
      .select('*, profiles(full_name)')
      .eq('work_order_id', jobId)
      .order('created_at', { ascending: false })
    if (data) setJobLogs(prev => ({ ...prev, [jobId]: data }))
  }

  // SUBMIT VENDOR UPDATE
  const handleSubmitUpdate = async (e: React.FormEvent<HTMLFormElement>, jobId: string) => {
    e.preventDefault()
    setSubmittingUpdate(true)
    const formData = new FormData(e.currentTarget)
    formData.append('workOrderId', jobId)

    const imageFile = formData.get('image') as File | null
    if (imageFile && imageFile.size > 0) {
      try {
        toast.info('Compressing image...')
        const compressed = await compressImage(imageFile)
        formData.set('image', compressed)
      } catch (err) { console.warn('Compression failed:', err) }
    }

    try {
      const result = await submitVendorUpdate(formData)
      if (result.success) {
        toast.success('Update posted!')
        await fetchJobLogs(jobId)
        await fetchJobs()
        const form = e.target as HTMLFormElement
        form.reset()
        setSelectedImage(null)
      } else { toast.error(result.message) }
    } catch (err: any) { toast.error('Failed: ' + (err.message || 'Unknown error')) }
    setSubmittingUpdate(false)
  }

  // SUBMIT BID
  const handleSubmitBid = async (e: React.FormEvent<HTMLFormElement>, woId: string) => {
    e.preventDefault()
    setSubmittingBid(woId)
    const formData = new FormData(e.currentTarget)
    formData.append('workOrderId', woId)
    try {
      const result = await submitBid(formData)
      if (result.success) {
        toast.success(result.message)
        await fetchJobs()
        const form = e.target as HTMLFormElement
        form.reset()
      } else { toast.error(result.message) }
    } catch (err: any) { toast.error('Failed: ' + (err.message || 'Unknown error')) }
    setSubmittingBid(null)
  }

  // WITHDRAW BID
  const handleWithdrawBid = async (bidId: string) => {
    try {
      const result = await withdrawBid(bidId)
      if (result.success) { toast.success(result.message); await fetchJobs() }
      else { toast.error(result.message) }
    } catch (err: any) { toast.error('Failed: ' + (err.message || 'Unknown error')) }
  }

  // SUBMIT INVOICE
  const handleSubmitInvoice = async (e: React.FormEvent<HTMLFormElement>, woId: string) => {
    e.preventDefault()
    setSubmittingInvoice(woId)
    const formData = new FormData(e.currentTarget)
    formData.append('workOrderId', woId)
    try {
      const result = await submitInvoice(formData)
      if (result.success) {
        toast.success(result.message)
        await fetchJobs()
        setInvoiceFile(null)
      } else { toast.error(result.message) }
    } catch (err: any) { toast.error('Failed: ' + (err.message || 'Unknown error')) }
    setSubmittingInvoice(null)
  }

  // Helper: get bid for a biddable job
  const getBidForJob = (woId: string) => myBids.find(b => b.work_order_id === woId && b.status !== 'Withdrawn')
  const getInvoiceForJob = (woId: string) => myInvoices.find(inv => inv.work_order_id === woId)

  // Stars renderer
  const renderStars = (rating: number | null) => {
    if (!rating) return <span className="text-slate-500 text-xs">No ratings</span>
    return (
      <div className="flex items-center gap-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <Star key={i} size={12} className={i <= Math.round(rating) ? 'text-yellow-400 fill-yellow-400' : 'text-slate-600'} />
        ))}
        <span className="text-xs text-yellow-400 font-bold ml-1">{rating}</span>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 pb-24">
      {/* MOBILE HEADER */}
      <header className="py-6 mb-6 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight italic">RYLEXA<span className="text-blue-500">.PRO</span></h1>
            <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">
              {vendorName ? `${vendorName} — Field Access` : 'Vendor Field Access'}
            </p>
            <div className="flex items-center gap-3 mt-1">
              {vendorRate && (
                <p className="text-emerald-400 text-[10px] font-black uppercase tracking-widest flex items-center gap-1">
                  <DollarSign size={10} /> ${vendorRate}/hr
                </p>
              )}
              {upgradeEnabled && performance && (
                <>
                  <span className="text-slate-700">|</span>
                  {renderStars(performance.avg_rating)}
                  <span className="text-slate-700">|</span>
                  <span className="text-[10px] font-black text-blue-400">{performance.total_completed_jobs} jobs</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {upgradeEnabled && (
              <Link
                href="/vendor-portal/availability"
                className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700 hover:border-blue-500 transition-colors"
                aria-label="Availability"
              >
                <CalendarDays size={16} className="text-blue-400" />
              </Link>
            )}
            <Link
              href="/vendor-portal/messages"
              className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700 hover:border-blue-500 transition-colors"
              aria-label="Messages"
            >
              <MessageSquare size={16} className="text-blue-400" />
            </Link>
            <button
              onClick={handleLogout}
              className="w-10 h-10 bg-slate-800 rounded-full flex items-center justify-center border border-slate-700 hover:border-red-500 transition-colors"
              aria-label="Log out"
            >
              <LogOut size={16} className="text-slate-400" />
            </button>
          </div>
        </div>
      </header>

      {/* TAB BAR (upgrade only) */}
      {upgradeEnabled && (
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab('jobs')}
            className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
              activeTab === 'jobs' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            <Wrench size={14} /> Jobs ({jobs.length})
          </button>
          <button
            onClick={() => setActiveTab('bids')}
            className={`flex-1 py-3 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
              activeTab === 'bids' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 border border-slate-700'
            }`}
          >
            <Gavel size={14} /> Open Bids ({biddableJobs.length})
          </button>
        </div>
      )}

      {/* BIDS TAB */}
      {upgradeEnabled && activeTab === 'bids' && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Gavel size={14} /> Available for Bidding
          </h2>
          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-500" /></div>
          ) : biddableJobs.length === 0 ? (
            <div className="bg-slate-800 rounded-2xl p-10 text-center border border-slate-700">
              <Gavel className="mx-auto mb-3 text-slate-600" size={32} />
              <p className="text-slate-400 font-bold">No open jobs available for bidding right now.</p>
            </div>
          ) : (
            biddableJobs.map(job => {
              const existingBid = getBidForJob(job.id)
              return (
                <div key={job.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5 shadow-lg">
                  <div className="flex justify-between items-start mb-3">
                    <div className="flex gap-2">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter ${
                        job.priority === 'Emergency' ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'
                      }`}>{job.priority}</span>
                      {job.category && (
                        <span className="px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter bg-purple-600 text-white">
                          {job.category}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-bold text-slate-500">{new Date(job.created_at).toLocaleDateString()}</span>
                  </div>

                  <h3 className="text-lg font-bold mb-1 leading-tight">{job.title}</h3>
                  <p className="text-slate-400 text-sm mb-3 line-clamp-3 italic">&ldquo;{job.description}&rdquo;</p>

                  <div className="flex items-center gap-2 text-xs font-bold text-blue-400 bg-blue-400/10 w-fit px-3 py-1.5 rounded-full mb-4">
                    <MapPin size={12} /> {job.property_name} &bull; {job.unit_name}
                  </div>

                  {existingBid ? (
                    <div className="space-y-3">
                      <div className="bg-slate-700/50 rounded-xl p-4 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Your Bid</span>
                          <p className="text-lg font-black text-emerald-400">${existingBid.bid_amount}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-lg text-[10px] font-black uppercase ${
                          existingBid.status === 'Pending' ? 'bg-yellow-500/20 text-yellow-400' :
                          existingBid.status === 'Accepted' ? 'bg-emerald-500/20 text-emerald-400' :
                          'bg-red-500/20 text-red-400'
                        }`}>{existingBid.status}</span>
                      </div>
                      {existingBid.status === 'Pending' && (
                        <button
                          onClick={() => handleWithdrawBid(existingBid.id)}
                          className="w-full py-3 bg-slate-700 hover:bg-slate-600 text-slate-300 font-black text-xs uppercase tracking-widest rounded-2xl transition-all"
                        >
                          Withdraw Bid
                        </button>
                      )}
                    </div>
                  ) : (
                    <form onSubmit={(e) => handleSubmitBid(e, job.id)} className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Bid Amount $</label>
                          <input
                            name="bidAmount" type="number" step="0.01" min="0" required
                            placeholder="0.00"
                            className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Est. Hours</label>
                          <input
                            name="estimatedHours" type="number" step="0.5" min="0"
                            placeholder="0.0"
                            className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Proposed Start Date</label>
                        <input
                          name="proposedStart" type="date"
                          className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500"
                        />
                      </div>
                      <textarea
                        name="notes" rows={2} placeholder="Add notes about your bid..."
                        className="w-full p-3 bg-slate-700 border border-slate-600 rounded-2xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500 resize-none"
                      />
                      <button
                        type="submit"
                        disabled={submittingBid === job.id}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                      >
                        {submittingBid === job.id ? <Loader2 className="animate-spin" size={18} /> : <Gavel size={18} />}
                        SUBMIT BID
                      </button>
                    </form>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* JOBS TAB */}
      {(activeTab === 'jobs' || !upgradeEnabled) && (
        <div className="space-y-4">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Clock size={14} /> Active Assignments ({jobs.length})
          </h2>

          {loading ? (
            <div className="flex justify-center py-20"><Loader2 className="animate-spin text-blue-500" /></div>
          ) : jobs.length === 0 ? (
            <div className="bg-slate-800 rounded-2xl p-10 text-center border border-slate-700">
              <CheckCircle className="mx-auto mb-3 text-slate-600" size={32} />
              <p className="text-slate-400 font-bold">No active jobs assigned to you.</p>
            </div>
          ) : (
            jobs.map(job => {
              const invoice = upgradeEnabled ? getInvoiceForJob(job.id) : null
              const showInvoiceSection = upgradeEnabled && ['Completed', 'Done', 'In Progress'].includes(job.status) && !invoice

              return (
                <div key={job.id} className="bg-slate-800 rounded-3xl border border-slate-700 p-5 shadow-lg active:scale-[0.98] transition-transform">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex gap-2">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter ${
                        job.priority === 'Emergency' ? 'bg-red-500 text-white' : 'bg-blue-600 text-white'
                      }`}>{job.priority}</span>
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-tighter ${
                        job.status === 'Assigned' ? 'bg-yellow-500 text-white' : 'bg-emerald-600 text-white'
                      }`}>{job.status === 'Assigned' ? 'NEW' : job.status}</span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-500 uppercase">{new Date(job.created_at).toLocaleDateString()}</span>
                  </div>

                  <h3 className="text-lg font-bold mb-1 leading-tight">{job.title}</h3>
                  <p className="text-slate-400 text-sm mb-4 line-clamp-2 italic">&ldquo;{job.description}&rdquo;</p>

                  <div className="space-y-2 mb-4">
                    <div className="flex items-center gap-2 text-xs font-bold text-blue-400 bg-blue-400/10 w-fit px-3 py-1.5 rounded-full">
                      <MapPin size={12} /> {job.property_name} &bull; {job.unit_name}
                    </div>
                  </div>

                  {/* INVOICE STATUS BADGE (if exists) */}
                  {invoice && (
                    <div className="bg-slate-700/50 rounded-xl p-3 mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FileText size={14} className="text-blue-400" />
                        <span className="text-xs font-bold text-slate-300">Invoice: ${invoice.amount}</span>
                      </div>
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                        invoice.status === 'Submitted' ? 'bg-blue-500/20 text-blue-400' :
                        invoice.status === 'Approved' ? 'bg-emerald-500/20 text-emerald-400' :
                        invoice.status === 'Rejected' ? 'bg-red-500/20 text-red-400' :
                        'bg-yellow-500/20 text-yellow-400'
                      }`}>{invoice.status}</span>
                    </div>
                  )}

                  {/* UPDATES TOGGLE (only for non-Assigned jobs) */}
                  {job.status !== 'Assigned' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (expandedJobId === job.id) {
                          setExpandedJobId(null)
                        } else {
                          setExpandedJobId(job.id)
                          fetchJobLogs(job.id)
                        }
                      }}
                      className="w-full py-3 mb-4 bg-slate-700 hover:bg-slate-600 text-slate-300 font-black text-xs uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 transition-all"
                    >
                      <MessageSquare size={14} />
                      Updates {expandedJobId === job.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                  )}

                  {/* EXPANDABLE UPDATES SECTION */}
                  {expandedJobId === job.id && (
                    <div className="mb-4 space-y-4">
                      {/* UPDATE FORM */}
                      <form onSubmit={(e) => handleSubmitUpdate(e, job.id)} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Hours Worked</label>
                            <input name="hours_worked" type="number" step="0.5" min="0" placeholder="0.0"
                              className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500" />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Materials $</label>
                            <input name="materials_cost" type="number" step="0.01" min="0" placeholder="0.00"
                              className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500" />
                          </div>
                        </div>
                        <textarea name="note" rows={2} placeholder="Add update note..."
                          className="w-full p-4 bg-slate-700 border border-slate-600 rounded-2xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500 resize-none" />
                        <div className="flex gap-2 items-center">
                          <label className="flex items-center justify-center w-12 h-12 bg-slate-700 border border-slate-600 rounded-xl cursor-pointer hover:border-blue-500 transition-all text-slate-400 shrink-0">
                            <Camera size={18} />
                            <input type="file" name="image" accept="image/*" capture="environment" className="hidden"
                              onChange={(e) => setSelectedImage(e.target.files?.[0] || null)} />
                          </label>
                          {selectedImage && (
                            <span className="text-xs text-blue-400 font-bold truncate max-w-[120px]">{selectedImage.name}</span>
                          )}
                          <button type="submit" disabled={submittingUpdate}
                            className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-black text-xs uppercase rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                            {submittingUpdate ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />}
                            Post Update
                          </button>
                        </div>
                      </form>

                      {/* INVOICE UPLOAD (upgrade only, completed jobs) */}
                      {showInvoiceSection && (
                        <form onSubmit={(e) => handleSubmitInvoice(e, job.id)} className="space-y-3 bg-slate-700/30 rounded-2xl p-4 border border-dashed border-slate-600">
                          <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                            <FileText size={12} /> Upload Invoice
                          </p>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Amount $</label>
                              <input name="amount" type="number" step="0.01" min="0.01" required placeholder="0.00"
                                className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500" />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">File</label>
                              <label className="flex items-center justify-center w-full p-3 bg-slate-700 border border-slate-600 rounded-xl cursor-pointer hover:border-blue-500 transition-all text-sm text-slate-400">
                                <Upload size={14} className="mr-2" />
                                {invoiceFile ? invoiceFile.name.slice(0, 15) + '...' : 'Choose file'}
                                <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                                  onChange={(e) => setInvoiceFile(e.target.files?.[0] || null)} />
                              </label>
                            </div>
                          </div>
                          <textarea name="description" rows={1} placeholder="Invoice description..."
                            className="w-full p-3 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-200 placeholder-slate-500 outline-none focus:border-blue-500 resize-none" />
                          <button type="submit" disabled={submittingInvoice === job.id}
                            className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-black text-xs uppercase rounded-2xl flex items-center justify-center gap-2 transition-all disabled:opacity-50">
                            {submittingInvoice === job.id ? <Loader2 className="animate-spin" size={14} /> : <FileText size={14} />}
                            Submit Invoice
                          </button>
                        </form>
                      )}

                      {/* EXISTING LOGS */}
                      <div className="space-y-3 max-h-60 overflow-y-auto">
                        {(jobLogs[job.id] || []).length === 0 ? (
                          <p className="text-xs text-slate-500 text-center py-4">No updates yet</p>
                        ) : (
                          (jobLogs[job.id] || []).map(log => (
                            <div key={log.id} className="bg-slate-700/50 rounded-xl p-3 space-y-2">
                              <div className="flex items-baseline justify-between">
                                <span className="text-xs font-bold text-blue-400">{log.profiles?.full_name || 'Team'}</span>
                                <span className="text-[9px] text-slate-500">{new Date(log.created_at).toLocaleString()}</span>
                              </div>
                              <p className="text-sm text-slate-300">{log.note}</p>
                              {log.image_url && (
                                <div className="relative h-32 w-full">
                                  <Image src={log.image_url} alt="Work photo" fill className="rounded-lg object-cover border border-slate-600" sizes="400px" />
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* CONDITIONAL ACTION BUTTONS */}
                  {job.status === 'Assigned' ? (
                    <div className="flex gap-3">
                      <button onClick={() => handleResponse(job.id, 'accept')} disabled={updatingId === job.id}
                        className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2">
                        {updatingId === job.id ? <Loader2 className="animate-spin" size={20} /> : <ThumbsUp size={20} />}
                        ACCEPT
                      </button>
                      <button onClick={() => handleResponse(job.id, 'reject')} disabled={updatingId === job.id}
                        className="flex-1 py-4 bg-red-600 hover:bg-red-500 text-white font-black rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2">
                        {updatingId === job.id ? <Loader2 className="animate-spin" size={20} /> : <XCircle size={20} />}
                        REJECT
                      </button>
                    </div>
                  ) : job.status !== 'Completed' && job.status !== 'Done' ? (
                    <button onClick={() => completeJob(job.id)} disabled={updatingId === job.id}
                      className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-2xl shadow-lg shadow-emerald-900/20 transition-all flex items-center justify-center gap-2">
                      {updatingId === job.id ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} />}
                      MARK COMPLETED
                    </button>
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* FOOTER NAV */}
      <nav className="fixed bottom-0 left-0 right-0 bg-slate-900/80 backdrop-blur-md border-t border-slate-800 p-4 flex justify-around items-center">
        <button
          onClick={() => setActiveTab('jobs')}
          className={`flex flex-col items-center gap-1 ${activeTab === 'jobs' ? 'text-blue-500' : 'text-slate-500'}`}
        >
          <Wrench size={24} />
          <span className="text-[10px] font-bold uppercase">Jobs</span>
        </button>
        {upgradeEnabled && (
          <button
            onClick={() => setActiveTab('bids')}
            className={`flex flex-col items-center gap-1 ${activeTab === 'bids' ? 'text-blue-500' : 'text-slate-500'}`}
          >
            <Gavel size={24} />
            <span className="text-[10px] font-bold uppercase">Bids</span>
          </button>
        )}
        {upgradeEnabled && (
          <Link href="/vendor-portal/availability" className="flex flex-col items-center gap-1 text-slate-500">
            <CalendarDays size={24} />
            <span className="text-[10px] font-bold uppercase">Schedule</span>
          </Link>
        )}
        <div className="flex flex-col items-center gap-1 text-slate-500">
          <Phone size={24} />
          <span className="text-[10px] font-bold uppercase">Contact</span>
        </div>
      </nav>
    </div>
  )
}
