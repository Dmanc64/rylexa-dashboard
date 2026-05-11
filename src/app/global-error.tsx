'use client'

/**
 * Global error boundary — catches errors in the root layout itself.
 * This is the last resort; it must render its own <html> and <body> tags
 * because the root layout may have failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f8fafc', margin: 0 }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: '2rem',
        }}>
          <div style={{
            background: 'white', borderRadius: '1.5rem', border: '1px solid #e2e8f0',
            boxShadow: '0 25px 50px -12px rgba(0,0,0,0.1)', padding: '3rem',
            maxWidth: '28rem', width: '100%', textAlign: 'center',
          }}>
            <div style={{
              width: '4rem', height: '4rem', background: '#fef2f2', borderRadius: '1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1.5rem',
              fontSize: '2rem',
            }}>
              ⚠️
            </div>
            <h2 style={{
              fontSize: '1.25rem', fontWeight: 900, color: '#0f172a',
              textTransform: 'uppercase', letterSpacing: '-0.02em', marginBottom: '0.5rem',
            }}>
              Application Error
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1.5rem' }}>
              A critical error has occurred. Please try refreshing the page.
            </p>
            {error.digest && (
              <p style={{
                fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace',
                background: '#f8fafc', padding: '0.75rem', borderRadius: '0.75rem',
                marginBottom: '1.5rem',
              }}>
                Reference: {error.digest}
              </p>
            )}
            <button
              onClick={reset}
              style={{
                padding: '0.75rem 1.5rem', background: '#0f172a', color: 'white',
                border: 'none', borderRadius: '0.75rem', cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Refresh Page
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
