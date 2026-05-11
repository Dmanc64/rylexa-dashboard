export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-8">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-xl p-12 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        </div>

        <h1 className="font-black italic text-2xl tracking-tighter mb-2">
          RYLEXA<span className="text-emerald-600">.OS</span>
        </h1>

        <h2 className="text-lg font-bold text-slate-900 uppercase tracking-tight mb-2">
          You&apos;re Offline
        </h2>
        <p className="text-sm text-slate-500 mb-8">
          Check your internet connection and try again. Your data is safe and will sync when you&apos;re back online.
        </p>

        <a
          href="/"
          className="inline-block px-6 py-3 bg-slate-900 text-white font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-emerald-600 transition-colors"
        >
          Try Again
        </a>
      </div>
    </div>
  )
}
