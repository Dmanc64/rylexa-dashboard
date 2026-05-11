import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'

export type PayrollEntry = {
  id: string
  name: string
  role: string // 'Staff' | 'Vendor' | 'Manager'
  type: 'Salary' | 'Hourly' | 'Contract'
  hours_logged: number
  rate: number
  total_payout: number
  status: 'Pending' | 'Approved' | 'Paid'
  region: string
}

export function usePayroll() {
  const [entries, setEntries] = useState<PayrollEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [totals, setTotals] = useState({ count: 0, amount: 0, hours: 0 })

  const fetchPayroll = useCallback(async () => {
    setLoading(true)
    
    // In a real app, you would query 'timesheets' or 'work_logs'
    // We are mocking a realistic response based on your Maintenance/Vendor data
    await new Promise(r => setTimeout(r, 800)) // Simulate network latency

    const mockData: PayrollEntry[] = [
      { id: '1', name: 'Mike The Plumber', role: 'Vendor', type: 'Contract', hours_logged: 12.5, rate: 85, total_payout: 1062.50, status: 'Pending', region: 'Reno' },
      { id: '2', name: 'Sarah Jenkins', role: 'Manager', type: 'Salary', hours_logged: 40, rate: 0, total_payout: 2400.00, status: 'Approved', region: 'Carson City' },
      { id: '3', name: 'Dave’s HVAC', role: 'Vendor', type: 'Contract', hours_logged: 4, rate: 120, total_payout: 480.00, status: 'Paid', region: 'Reno' },
      { id: '4', name: 'Jessica Lee', role: 'Staff', type: 'Hourly', hours_logged: 38, rate: 22, total_payout: 836.00, status: 'Pending', region: 'Sparks' },
      { id: '5', name: 'Reno Rooter', role: 'Vendor', type: 'Contract', hours_logged: 2.5, rate: 95, total_payout: 237.50, status: 'Pending', region: 'Reno' },
    ]

    setEntries(mockData)
    
    // Calculate Totals
    setTotals({
      count: mockData.length,
      amount: mockData.reduce((acc, curr) => acc + curr.total_payout, 0),
      hours: mockData.reduce((acc, curr) => acc + curr.hours_logged, 0)
    })
    
    setLoading(false)
  }, [])

  // Action: Approve All Pending
  const approveRun = async () => {
    setEntries(prev => prev.map(e => e.status === 'Pending' ? { ...e, status: 'Approved' } : e))
  }

  // Action: Simulate CSV Export
  const exportRun = async () => {
    setExporting(true)
    await new Promise(r => setTimeout(r, 1500))
    setExporting(false)
    return true
  }

  useEffect(() => {
    fetchPayroll()
  }, [fetchPayroll])

  return { entries, totals, loading, exporting, approveRun, exportRun, refresh: fetchPayroll }
}