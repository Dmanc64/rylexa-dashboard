'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabaseClient'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { CreditCard, Loader2, Lock, ShieldCheck, CheckCircle } from 'lucide-react'
import AccessibleModal from '@/components/AccessibleModal'
import StripeProvider from '@/components/StripeProvider'
import { CardElement, useStripe, useElements } from '@stripe/react-stripe-js'

type Props = {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
}

// ── Inner form that lives inside StripeProvider ──

function SaveCardForm({ onClose, onSuccess }: Omit<Props, 'isOpen'>) {
  const stripe = useStripe()
  const elements = useElements()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [savedBrand, setSavedBrand] = useState<string | null>(null)
  const [savedLast4, setSavedLast4] = useState<string | null>(null)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!stripe || !elements) {
      setError('Payment system is loading. Please wait a moment.')
      return
    }

    const cardElement = elements.getElement(CardElement)
    if (!cardElement) {
      setError('Card input not available. Please refresh and try again.')
      return
    }

    setLoading(true)

    try {
      // 1. Create a PaymentMethod from the card element
      const { paymentMethod, error: pmError } = await stripe.createPaymentMethod({
        type: 'card',
        card: cardElement,
      })

      if (pmError || !paymentMethod) {
        setError(pmError?.message || 'Failed to process card details.')
        setLoading(false)
        return
      }

      // 2. Send the payment method to the save-payment-method edge function
      const { data: body, error: fnError } = await supabase.functions.invoke('save-payment-method', {
        body: { paymentMethodId: paymentMethod.id },
      })

      if (fnError) {
        let msg = 'Failed to save card'
        if (fnError instanceof FunctionsHttpError) {
          const errBody = await fnError.context.json().catch(() => null)
          msg = errBody?.error || errBody?.message || msg
        }
        setError(msg)
        setLoading(false)
        return
      }

      // 3. Success
      setSavedBrand(paymentMethod.card?.brand ?? null)
      setSavedLast4(paymentMethod.card?.last4 ?? null)
      setSuccess(true)
      toast.success('Card saved successfully')

      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 2000)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save card. Please try again.'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="p-10 text-center">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-1">Card Saved!</h3>
        <p className="text-slate-500 text-sm">
          Your card has been securely saved for future payments.
        </p>
        {savedBrand && savedLast4 && (
          <p className="text-slate-400 text-xs mt-1">
            {savedBrand.charAt(0).toUpperCase() + savedBrand.slice(1)} ending in {savedLast4}
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="p-6 space-y-5">
      {/* Card Element */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Card Details</label>
        <div className="px-4 py-3.5 border border-slate-300 rounded-xl bg-white focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: '16px',
                  color: '#0f172a',
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  '::placeholder': { color: '#94a3b8' },
                },
                invalid: { color: '#dc2626' },
              },
              hidePostalCode: false,
            }}
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600">
          {error}
        </div>
      )}

      {/* Security Notice */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <Lock size={14} />
        <span>Your card info is encrypted and secure.</span>
        <ShieldCheck size={14} className="ml-auto text-emerald-500" />
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={loading || !stripe}
        className="w-full bg-blue-600 text-white font-bold py-4 rounded-xl hover:bg-blue-700 transition flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" size={18} />
            Saving...
          </>
        ) : (
          <>
            <CreditCard size={18} />
            Save Card
          </>
        )}
      </button>
    </form>
  )
}

// ── Main Modal Component ──

export default function SaveCardModal({ isOpen, onClose, onSuccess }: Props) {
  return (
    <AccessibleModal
      isOpen={isOpen}
      onClose={onClose}
      title="Save Payment Method"
      subtitle="Securely save a card for future payments"
      size="max-w-md"
      headerBg="bg-slate-900"
      closeBtnColor="text-slate-400"
      headerTextColor="text-white"
    >
      {isOpen && (
        <StripeProvider>
          <SaveCardForm onClose={onClose} onSuccess={onSuccess} />
        </StripeProvider>
      )}
    </AccessibleModal>
  )
}
