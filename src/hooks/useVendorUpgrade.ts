import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { acceptBid, rejectBid } from '@/actions/vendor-bid-actions'
import { reviewInvoice } from '@/actions/vendor-invoice-actions'

// ── Types ──

export type VendorBid = {
  id: string
  work_order_id: string
  vendor_id: string
  bid_amount: number
  estimated_hours: number | null
  proposed_start: string | null
  notes: string | null
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Withdrawn'
  created_at: string
  updated_at: string
  vendor_name?: string
  vendor_trade?: string
}

export type VendorInvoice = {
  id: string
  work_order_id: string
  vendor_id: string
  amount: number
  description: string | null
  line_items: any[]
  file_url: string | null
  file_name: string | null
  status: 'Submitted' | 'Under Review' | 'Approved' | 'Rejected'
  admin_notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  vendor_name?: string
}

export type VendorAvailabilitySlot = {
  id: string
  vendor_id: string
  day_of_week: number
  start_time: string
  end_time: string
}

export type VendorUnavailableDate = {
  id: string
  vendor_id: string
  date: string
  reason: string | null
  created_at: string
}

export type VendorPerformance = {
  vendor_id: string
  company_name: string | null
  contact_name: string | null
  trade_type: string | null
  hourly_rate: number | null
  total_completed_jobs: number
  active_jobs: number
  avg_rating: number | null
  review_count: number
  completion_rate_pct: number | null
}

export type VendorReview = {
  id: string
  work_order_id: string
  vendor_id: string
  rating: number
  comment: string | null
  reviewed_by: string
  created_at: string
  reviewer_name?: string
}

// ── Constants ──

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export const DAY_NAMES_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export const BID_STATUS_COLORS: Record<string, string> = {
  Pending: 'bg-yellow-100 text-yellow-700',
  Accepted: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
  Withdrawn: 'bg-slate-100 text-slate-500',
}

export const INVOICE_STATUS_COLORS: Record<string, string> = {
  Submitted: 'bg-blue-100 text-blue-700',
  'Under Review': 'bg-yellow-100 text-yellow-700',
  Approved: 'bg-green-100 text-green-700',
  Rejected: 'bg-red-100 text-red-700',
}

// ── Hooks ──

/**
 * Fetch bids for a specific work order (admin use).
 */
export function useVendorBids(workOrderId: string | null) {
  const queryClient = useQueryClient()

  const { data: bids = [], isLoading } = useQuery({
    queryKey: ['vendor-bids', workOrderId],
    queryFn: async () => {
      if (!workOrderId) return []
      const { data, error } = await supabase
        .from('vendor_bids')
        .select('*, vendors ( company_name, contact_name, trade_type )')
        .eq('work_order_id', workOrderId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []).map((b: any) => ({
        id: b.id,
        work_order_id: b.work_order_id,
        vendor_id: b.vendor_id,
        bid_amount: b.bid_amount,
        estimated_hours: b.estimated_hours,
        proposed_start: b.proposed_start,
        notes: b.notes,
        status: b.status,
        created_at: b.created_at,
        updated_at: b.updated_at,
        vendor_name: b.vendors?.company_name || b.vendors?.contact_name || 'Unknown',
        vendor_trade: b.vendors?.trade_type || '',
      })) as VendorBid[]
    },
    enabled: !!workOrderId,
  })

  const acceptMutation = useMutation({
    mutationFn: async (bidId: string) => {
      const result = await acceptBid(bidId)
      if (!result.success) throw new Error(result.message)
      return result
    },
    onSuccess: (result) => {
      toast.success(result.message)
      queryClient.invalidateQueries({ queryKey: ['vendor-bids', workOrderId] })
      queryClient.invalidateQueries({ queryKey: ['maintenance'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const rejectMutation = useMutation({
    mutationFn: async (bidId: string) => {
      const result = await rejectBid(bidId)
      if (!result.success) throw new Error(result.message)
      return result
    },
    onSuccess: () => {
      toast.success('Bid rejected')
      queryClient.invalidateQueries({ queryKey: ['vendor-bids', workOrderId] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return {
    bids,
    loading: isLoading,
    acceptBid: (bidId: string) => acceptMutation.mutateAsync(bidId),
    rejectBid: (bidId: string) => rejectMutation.mutateAsync(bidId),
    accepting: acceptMutation.isPending,
    rejecting: rejectMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['vendor-bids', workOrderId] }),
  }
}

/**
 * Fetch invoices for a specific work order (admin use).
 */
export function useVendorInvoices(workOrderId: string | null) {
  const queryClient = useQueryClient()

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['vendor-invoices', workOrderId],
    queryFn: async () => {
      if (!workOrderId) return []
      const { data, error } = await supabase
        .from('vendor_invoices')
        .select('*, vendors ( company_name, contact_name )')
        .eq('work_order_id', workOrderId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []).map((inv: any) => ({
        id: inv.id,
        work_order_id: inv.work_order_id,
        vendor_id: inv.vendor_id,
        amount: inv.amount,
        description: inv.description,
        line_items: inv.line_items || [],
        file_url: inv.file_url,
        file_name: inv.file_name,
        status: inv.status,
        admin_notes: inv.admin_notes,
        reviewed_by: inv.reviewed_by,
        reviewed_at: inv.reviewed_at,
        created_at: inv.created_at,
        vendor_name: inv.vendors?.company_name || inv.vendors?.contact_name || 'Unknown',
      })) as VendorInvoice[]
    },
    enabled: !!workOrderId,
  })

  const reviewMutation = useMutation({
    mutationFn: async ({ invoiceId, action, notes }: { invoiceId: string; action: 'approve' | 'reject'; notes?: string }) => {
      const result = await reviewInvoice(invoiceId, action, notes)
      if (!result.success) throw new Error(result.message)
      return result
    },
    onSuccess: (result) => {
      toast.success(result.message)
      queryClient.invalidateQueries({ queryKey: ['vendor-invoices', workOrderId] })
      queryClient.invalidateQueries({ queryKey: ['maintenance'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return {
    invoices,
    loading: isLoading,
    reviewInvoice: (invoiceId: string, action: 'approve' | 'reject', notes?: string) =>
      reviewMutation.mutateAsync({ invoiceId, action, notes }),
    reviewing: reviewMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['vendor-invoices', workOrderId] }),
  }
}

/**
 * Fetch vendor availability schedule + blocked dates (admin use).
 */
export function useVendorAvailability(vendorId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ['vendor-availability', vendorId],
    queryFn: async () => {
      if (!vendorId) return { schedule: [], blockedDates: [] }

      const [scheduleRes, datesRes] = await Promise.all([
        supabase
          .from('vendor_availability')
          .select('*')
          .eq('vendor_id', vendorId)
          .order('day_of_week')
          .order('start_time'),
        supabase
          .from('vendor_unavailable_dates')
          .select('*')
          .eq('vendor_id', vendorId)
          .gte('date', new Date().toISOString().split('T')[0])
          .order('date'),
      ])

      if (scheduleRes.error) throw scheduleRes.error
      if (datesRes.error) throw datesRes.error

      return {
        schedule: (scheduleRes.data || []) as VendorAvailabilitySlot[],
        blockedDates: (datesRes.data || []) as VendorUnavailableDate[],
      }
    },
    enabled: !!vendorId,
  })

  return {
    schedule: data?.schedule ?? [],
    blockedDates: data?.blockedDates ?? [],
    loading: isLoading,
  }
}

/**
 * Check if a vendor is available today based on their schedule and blocked dates.
 */
export function getVendorAvailabilityStatus(
  schedule: VendorAvailabilitySlot[],
  blockedDates: VendorUnavailableDate[]
): 'available' | 'busy' | 'unavailable' | 'unknown' {
  if (schedule.length === 0 && blockedDates.length === 0) return 'unknown'

  const today = new Date()
  const todayStr = today.toISOString().split('T')[0]
  const dayOfWeek = today.getDay()

  // Check if today is blocked
  if (blockedDates.some(d => d.date === todayStr)) return 'unavailable'

  // Check if vendor has schedule for today
  const todaySlots = schedule.filter(s => s.day_of_week === dayOfWeek)
  if (todaySlots.length === 0) return 'unavailable'

  // Check if current time falls within any slot
  const now = today.toTimeString().slice(0, 5)
  const isInSlot = todaySlots.some(s => now >= s.start_time.slice(0, 5) && now <= s.end_time.slice(0, 5))

  return isInSlot ? 'available' : 'busy'
}

/**
 * Fetch vendor performance summary (admin use).
 */
export function useVendorPerformance(vendorId?: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ['vendor-performance', vendorId || 'all'],
    queryFn: async () => {
      let query = supabase.from('vendor_performance_summary').select('*')
      if (vendorId) query = query.eq('vendor_id', vendorId)
      const { data, error } = await query.order('total_completed_jobs', { ascending: false })
      if (error) throw error
      return (data || []) as VendorPerformance[]
    },
  })

  return {
    performance: data ?? [],
    loading: isLoading,
  }
}

/**
 * Fetch reviews for a vendor + submit new review.
 */
export function useVendorReviews(vendorId: string | null) {
  const queryClient = useQueryClient()

  const { data: reviews = [], isLoading } = useQuery({
    queryKey: ['vendor-reviews', vendorId],
    queryFn: async () => {
      if (!vendorId) return []
      const { data, error } = await supabase
        .from('vendor_reviews')
        .select('*, profiles:reviewed_by ( full_name )')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []).map((r: any) => ({
        id: r.id,
        work_order_id: r.work_order_id,
        vendor_id: r.vendor_id,
        rating: r.rating,
        comment: r.comment,
        reviewed_by: r.reviewed_by,
        created_at: r.created_at,
        reviewer_name: r.profiles?.full_name || 'Admin',
      })) as VendorReview[]
    },
    enabled: !!vendorId,
  })

  const submitReviewMutation = useMutation({
    mutationFn: async (review: { work_order_id: string; vendor_id: string; rating: number; comment?: string; reviewed_by: string }) => {
      const { error } = await supabase.from('vendor_reviews').insert(review)
      if (error) throw error
    },
    onSuccess: () => {
      toast.success('Vendor review submitted')
      queryClient.invalidateQueries({ queryKey: ['vendor-reviews', vendorId] })
      queryClient.invalidateQueries({ queryKey: ['vendor-performance'] })
    },
    onError: (err: Error) => toast.error('Failed to submit review: ' + err.message),
  })

  return {
    reviews,
    loading: isLoading,
    submitReview: submitReviewMutation.mutateAsync,
    submitting: submitReviewMutation.isPending,
    refresh: () => queryClient.invalidateQueries({ queryKey: ['vendor-reviews', vendorId] }),
  }
}

/**
 * Check if a work order already has a vendor review.
 */
export function useWorkOrderReview(workOrderId: string | null) {
  const { data, isLoading } = useQuery({
    queryKey: ['work-order-review', workOrderId],
    queryFn: async () => {
      if (!workOrderId) return null
      const { data, error } = await supabase
        .from('vendor_reviews')
        .select('id, rating, comment, created_at')
        .eq('work_order_id', workOrderId)
        .single()
      if (error && error.code !== 'PGRST116') throw error
      return data as VendorReview | null
    },
    enabled: !!workOrderId,
  })

  return { review: data ?? null, loading: isLoading }
}
