'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

/**
 * TanStack Query provider wrapper for Rylexa.
 *
 * - staleTime 60s: data stays fresh for 1 minute (avoids refetching on tab switch)
 * - gcTime 5min: unused data is garbage collected after 5 minutes
 * - retry 1: one retry on failure (Supabase errors are usually auth-related, not transient)
 * - refetchOnWindowFocus: revalidate data when user returns to tab
 */
export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,        // 1 minute
            gcTime: 5 * 60 * 1000,       // 5 minutes
            retry: 1,
            refetchOnWindowFocus: true,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
