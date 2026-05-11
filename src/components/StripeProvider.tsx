'use client'

import { Elements } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'

const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
const stripePromise = stripeKey ? loadStripe(stripeKey) : null

type Props = {
  children: React.ReactNode
}

export default function StripeProvider({ children }: Props) {
  return (
    <Elements stripe={stripePromise}>
      {children}
    </Elements>
  )
}
