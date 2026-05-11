'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import {
  Wrench, Loader2, AlertCircle, ChevronDown, ChevronUp,
  Clock, CheckCircle2, Plus, Calendar, User, ImageIcon,
} from 'lucide-react'

type WorkOrder = {
  id: string
  title: string
  description: string | null
  priority: string
  status: string
  category: string | null
  created_at: string
  updated_at: string | null
  scheduled_date: string | null
  vendor_id: string | null
  vendors?: {
    company_name: string | null
    contact_name: string | null
  } | null
}

type WorkOrderImage = {
  id: string
  file_path: string
  file_name: string
}

const PRIORITY_COLORS: Record<string, string> = {
  Emergency: 'bg-red-500',
  High: 'bg-orange-500',
  Normal: 'bg-blue-500',
  Medium: 'bg-blue-500',
  Low: 'bg-slate-400',
}

const STATUS_STYLES: Record<string, string> = {
  Open: 'text-blue-700 bg-blue-50 border-blue-200',
  Assigned: 'text-indigo-700 bg-indigo-50 border-indigo-200',
  'In Progress': 'text-amber-700 bg-amber-50 border-amber-200',
  Completed: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Done: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  Closed: 'text-slate-600 bg-slate-50 border-slate-200',
  'On Hold': 'text-slate-600 bg-slate-100 border-slate-200',
}

const ACTIVE_STATUSES = ['Open', 'Assigned', 'In Progress']

export default function TenantRepairsPage() {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [images, setImages] = useState<WorkOrderImage[]>([])
  const [loadingImages, setLoadingImages] = useState(false)

  useEffect(() => {
    async function fetchOrders() {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { setLoading(false); return }

      // Get tenant_id via lease chain
      const { data: lease } = await supabase
        .from('leases')
        .select('tenant_id')
        .eq('user_id', user.id)
        .eq('status', 'Active')
        .maybeSingle()

      if (!lease?.tenant_id) { setLoading(false); return }

      const { data, error } = await supabase
        .from('work_orders')
        .select(`
          id, title, description, priority, status, category,
          created_at, updated_at, scheduled_date, vendor_id,
          vendors:vendor_id(company_name, contact_name)
        `)
        .eq('tenant_id', lease.tenant_id)
        .eq('archived', false)
        .order('created_at', { ascending: false })

      if (error) console.error('Failed to fetch work orders:', error.message)
      if (data) setOrders(data as unknown as WorkOrder[])
      setLoading(false)
    }
    fetchOrders()
  }, [])

  const toggleExpand = async (orderId: string) => {
    if (expandedId === orderId) {
      setExpandedId(null)
      return
    }
    setExpandedId(orderId)
    setLoadingImages(true)
    setImages([])

    const { data, error } = await supabase
      .from('work_order_images')
      .select('id, file_path, file_name')
      .eq('work_order_id', orderId)
      .order('created_at', { ascending: true })

    if (!error && data) setImages(data)
    setLoadingImages(false)
  }

  const active = orders.filter(o => ACTIVE_STATUSES.includes(o.status))
  const completed = orders.filter(o => !ACTIVE_STATUSES.includes(o.status))

  return (
    <div className="max-w-2xl mx-auto p-6 md:p-10 space-y-8">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">My Repairs</h1>
          <p className="text-slate-500 font-medium text-sm">Track your maintenance requests</p>
        </div>
        <Link
          href="/portal/maintenance"
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-emerald-600 transition-colors shadow-md"
        >
          <Plus size={14} />
          New Request
        </Link>
      </div>

      {loading ? (
        <div className="py-20 text-center">
          <Loader2 className="animate-spin mx-auto text-blue-500" size={32} />
        </div>
      ) : orders.length === 0 ? (
        <div className="bg-white rounded-3xl border border-slate-200 p-16 text-center">
          <Wrench size={40} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500 font-bold mb-2">No repair requests yet</p>
          <p className="text-slate-400 text-sm mb-6">
            When you submit a repair request, it will appear here so you can track its progress.
          </p>
          <Link
            href="/portal/maintenance"
            className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl text-sm font-bold hover:bg-emerald-600 transition-colors"
          >
            <Plus size={16} />
            Submit a Request
          </Link>
        </div>
      ) : (
        <>
          {/* ACTIVE REQUESTS */}
          {active.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 ml-2">
                <Clock size={14} />
                Active Requests ({active.length})
              </h3>
              {active.map(wo => (
                <RepairCard
                  key={wo.id}
                  wo={wo}
                  isExpanded={expandedId === wo.id}
                  onToggle={() => toggleExpand(wo.id)}
                  images={expandedId === wo.id ? images : []}
                  loadingImages={expandedId === wo.id && loadingImages}
                />
              ))}
            </div>
          )}

          {/* COMPLETED REQUESTS */}
          {completed.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 ml-2">
                <CheckCircle2 size={14} />
                Completed ({completed.length})
              </h3>
              {completed.map(wo => (
                <RepairCard
                  key={wo.id}
                  wo={wo}
                  isExpanded={expandedId === wo.id}
                  onToggle={() => toggleExpand(wo.id)}
                  images={expandedId === wo.id ? images : []}
                  loadingImages={expandedId === wo.id && loadingImages}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Repair Card Sub-component ──

function RepairCard({
  wo,
  isExpanded,
  onToggle,
  images,
  loadingImages,
}: {
  wo: WorkOrder
  isExpanded: boolean
  onToggle: () => void
  images: WorkOrderImage[]
  loadingImages: boolean
}) {
  const priorityDot = PRIORITY_COLORS[wo.priority] ?? 'bg-slate-400'
  const statusStyle = STATUS_STYLES[wo.status] ?? 'text-slate-600 bg-slate-50 border-slate-200'
  const vendorName = wo.vendors?.company_name || wo.vendors?.contact_name
  const isCompleted = !ACTIVE_STATUSES.includes(wo.status)

  return (
    <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm transition-all ${
      isCompleted ? 'border-slate-100 opacity-80' : 'border-slate-200'
    }`}>
      {/* Card Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-5 hover:bg-slate-50 transition-colors text-left"
      >
        <span className={`w-3 h-3 rounded-full mt-1.5 shrink-0 ${priorityDot}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-bold text-sm text-slate-900 truncate">{wo.title}</span>
            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider border shrink-0 ${statusStyle}`}>
              {wo.status}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] text-slate-400 font-medium">
            <span>
              Submitted {new Date(wo.created_at).toLocaleDateString()}
            </span>
            {vendorName && (
              <span className="flex items-center gap-1">
                <User size={10} />
                {vendorName}
              </span>
            )}
            {wo.scheduled_date && (
              <span className="flex items-center gap-1 text-blue-500">
                <Calendar size={10} />
                Scheduled {new Date(wo.scheduled_date + 'T00:00:00').toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        {isExpanded
          ? <ChevronUp size={16} className="text-slate-400 mt-1.5 shrink-0" />
          : <ChevronDown size={16} className="text-slate-400 mt-1.5 shrink-0" />
        }
      </button>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="border-t border-slate-100 p-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Description */}
          {wo.description && (
            <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Description</p>
              <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{wo.description}</p>
            </div>
          )}

          {/* Photos */}
          {loadingImages ? (
            <div className="py-4 text-center">
              <Loader2 size={16} className="animate-spin mx-auto text-slate-400" />
            </div>
          ) : images.length > 0 ? (
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1">
                <ImageIcon size={12} /> Photos ({images.length})
              </p>
              <div className="flex gap-2 flex-wrap">
                {images.map(img => {
                  const publicUrl = supabase.storage.from('maintenance-images').getPublicUrl(img.file_path).data.publicUrl
                  return (
                    <a
                      key={img.id}
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-20 h-20 rounded-xl overflow-hidden border border-slate-200 hover:border-blue-400 transition-colors"
                    >
                      <img
                        src={publicUrl}
                        alt={img.file_name}
                        className="w-full h-full object-cover"
                      />
                    </a>
                  )
                })}
              </div>
            </div>
          ) : null}

          {/* Meta Info */}
          <div className="flex gap-4 text-[10px] text-slate-400 font-medium">
            {wo.category && (
              <span>Category: <span className="text-slate-600 font-bold">{wo.category}</span></span>
            )}
            {wo.priority && (
              <span>Priority: <span className="text-slate-600 font-bold">{wo.priority}</span></span>
            )}
            {wo.updated_at && (
              <span>Last Updated: <span className="text-slate-600 font-bold">{new Date(wo.updated_at).toLocaleDateString()}</span></span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
