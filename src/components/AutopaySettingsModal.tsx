'use client'

import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { CalendarClock, CreditCard, Loader2, Power, PowerOff, DollarSign, AlertCircle } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import { useAutopaySettings } from '@/hooks/usePayments'
import type { SavedCard } from '@/hooks/usePayments'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  leaseId: string
  savedCards: SavedCard[]
}

type AmountType = 'full_balance' | 'fixed'

export default function AutopaySettingsModal({
  isOpen,
  onClose,
  onSuccess,
  leaseId,
  savedCards,
}: Props) {
  const {
    data: autopaySettings,
    loading: loadingSettings,
    configureAutopay,
    configuringAutopay,
    disableAutopay,
    disablingAutopay,
  } = useAutopaySettings(leaseId)

  // ── Form state ──
  const [paymentMethodId, setPaymentMethodId] = useState('')
  const [amountType, setAmountType] = useState<AmountType>('full_balance')
  const [fixedAmount, setFixedAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [dayOfMonth, setDayOfMonth] = useState(1)
  const [error, setError] = useState<string | null>(null)

  const isActive = autopaySettings?.is_active ?? false

  // ── Populate form when existing settings load ──
  useEffect(() => {
    if (autopaySettings) {
      setPaymentMethodId(autopaySettings.payment_method_id || '')
      setAmountType(autopaySettings.amount_type === 'fixed' ? 'fixed' : 'full_balance')
      setFixedAmount(autopaySettings.fixed_amount ? String(autopaySettings.fixed_amount) : '')
      setMaxAmount(autopaySettings.max_amount ? String(autopaySettings.max_amount) : '')
      setDayOfMonth(autopaySettings.day_of_month || 1)
    } else {
      // Default to the first saved card
      setPaymentMethodId(savedCards[0]?.stripe_payment_method_id ?? '')
      setAmountType('full_balance')
      setFixedAmount('')
      setMaxAmount('')
      setDayOfMonth(1)
    }
  }, [autopaySettings, savedCards])

  // ── Reset form when modal opens ──
  useEffect(() => {
    if (isOpen) {
      setError(null)
    }
  }, [isOpen])

  // ── Compute next payment date ──
  const nextPaymentDate = useMemo(() => {
    const today = new Date()
    const year = today.getFullYear()
    const month = today.getMonth()
    const day = dayOfMonth

    // If this month's day has passed, use next month
    let nextDate = new Date(year, month, day)
    if (nextDate <= today) {
      nextDate = new Date(year, month + 1, day)
    }

    return nextDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }, [dayOfMonth])

  // ── Format card label ──
  const formatCardLabel = (card: SavedCard) => {
    const brand = card.card_brand
      ? card.card_brand.charAt(0).toUpperCase() + card.card_brand.slice(1)
      : 'Card'
    const last4 = card.card_last4 || '----'
    const expiry = card.exp_month && card.exp_year
      ? ` (${String(card.exp_month).padStart(2, '0')}/${String(card.exp_year).slice(-2)})`
      : ''
    const defaultBadge = card.is_default ? ' - Default' : ''
    return `${brand} ****${last4}${expiry}${defaultBadge}`
  }

  // ── Enable / Update autopay ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!paymentMethodId) {
      setError('Please select a payment method.')
      return
    }

    if (amountType === 'fixed') {
      const num = Number(fixedAmount)
      if (!fixedAmount || num <= 0) {
        setError('Please enter a valid fixed payment amount.')
        return
      }
    }

    if (maxAmount) {
      const num = Number(maxAmount)
      if (num <= 0) {
        setError('Max amount must be greater than zero.')
        return
      }
    }

    try {
      await configureAutopay({
        payment_method_id: paymentMethodId,
        amount_type: amountType,
        fixed_amount: amountType === 'fixed' ? Number(fixedAmount) : null,
        max_amount: maxAmount ? Number(maxAmount) : null,
        day_of_month: dayOfMonth,
      })
      onSuccess?.()
      onClose()
    } catch {
      // Error toast is already handled by the mutation's onError
    }
  }

  // ── Disable autopay ──
  const handleDisable = async () => {
    setError(null)
    try {
      await disableAutopay()
      onSuccess?.()
      onClose()
    } catch {
      // Error toast is already handled by the mutation's onError
    }
  }

  const isBusy = configuringAutopay || disablingAutopay

  // ── Day options (1-28) ──
  const dayOptions = Array.from({ length: 28 }, (_, i) => i + 1)

  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Autopay Settings"
      subtitle="Automatically pay rent each month"
      size="max-w-md"
      headerBg="bg-slate-900"
      closeBtnColor="text-slate-400"
      headerTextColor="text-white"
    >
      {loadingSettings ? (
        <div className="p-10 flex flex-col items-center justify-center gap-3">
          <Loader2 className="animate-spin text-slate-400" size={28} />
          <p className="text-sm text-slate-500">Loading autopay settings...</p>
        </div>
      ) : savedCards.length === 0 ? (
        <div className="p-8 text-center space-y-3">
          <div className="w-14 h-14 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
            <CreditCard size={24} />
          </div>
          <h3 className="text-lg font-bold text-slate-900">No Saved Cards</h3>
          <p className="text-sm text-slate-500">
            You need to save a payment method before setting up autopay.
          </p>
          <button
            onClick={onClose}
            className="mt-2 bg-slate-100 text-slate-700 font-bold px-6 py-2.5 rounded-xl hover:bg-slate-200 transition"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Current Status Banner */}
          {isActive && (
            <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <Power size={16} className="text-emerald-600 shrink-0" />
              <div className="text-sm">
                <span className="font-bold text-emerald-700">Autopay is active</span>
                {autopaySettings?.next_run_date && (
                  <p className="text-emerald-600 text-xs mt-0.5">
                    Next payment: {new Date(autopaySettings.next_run_date).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Payment Method */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Payment Method
            </label>
            <select
              value={paymentMethodId}
              onChange={(e) => setPaymentMethodId(e.target.value)}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
            >
              <option value="">Select a card...</option>
              {savedCards.map((card) => (
                <option key={card.id} value={card.stripe_payment_method_id}>
                  {formatCardLabel(card)}
                </option>
              ))}
            </select>
          </div>

          {/* Amount Type */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Amount
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setAmountType('full_balance')}
                className={`px-4 py-3 rounded-xl text-sm font-bold border-2 transition ${
                  amountType === 'full_balance'
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                Full Balance
              </button>
              <button
                type="button"
                onClick={() => setAmountType('fixed')}
                className={`px-4 py-3 rounded-xl text-sm font-bold border-2 transition ${
                  amountType === 'fixed'
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                }`}
              >
                Fixed Amount
              </button>
            </div>
          </div>

          {/* Fixed Amount Input */}
          {amountType === 'fixed' && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Fixed Payment Amount
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={fixedAmount}
                  onChange={(e) => setFixedAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full pl-8 pr-4 py-3 border border-slate-300 rounded-xl text-lg font-bold text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {/* Max Amount (Optional) */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Maximum Amount <span className="text-slate-400 font-normal">(optional cap)</span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                placeholder="No limit"
                className="w-full pl-8 pr-4 py-3 border border-slate-300 rounded-xl text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <p className="text-xs text-slate-400 mt-1">
              If the balance exceeds this amount, autopay will be skipped.
            </p>
          </div>

          {/* Day of Month */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Day of Month
            </label>
            <div className="flex items-center gap-3">
              <select
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm font-medium text-slate-900 outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? '1st' : d === 2 ? '2nd' : d === 3 ? '3rd' : `${d}th`} of each month
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Next Payment Date */}
          <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <CalendarClock size={16} className="text-blue-600 shrink-0" />
            <p className="text-xs text-blue-700">
              <span className="font-bold">Next payment:</span> {nextPaymentDate}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs font-bold text-red-600">{error}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2 pt-1">
            <button
              type="submit"
              disabled={isBusy}
              className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {configuringAutopay ? (
                <>
                  <Loader2 className="animate-spin" size={18} />
                  Saving...
                </>
              ) : (
                <>
                  <DollarSign size={18} />
                  {isActive ? 'Update Autopay' : 'Enable Autopay'}
                </>
              )}
            </button>

            {isActive && (
              <button
                type="button"
                onClick={handleDisable}
                disabled={isBusy}
                className="w-full bg-white text-red-600 font-bold py-3 rounded-xl border-2 border-red-200 hover:bg-red-50 transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {disablingAutopay ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    Disabling...
                  </>
                ) : (
                  <>
                    <PowerOff size={16} />
                    Disable Autopay
                  </>
                )}
              </button>
            )}
          </div>
        </form>
      )}
    </AccessibleModal>
  )
}
