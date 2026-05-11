import Link from 'next/link'

// This layout applies ONLY to public pages (Home, Login, Apply)
export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* PUBLIC NAVBAR */}
      <nav className="p-6 flex justify-between items-center max-w-7xl mx-auto w-full">
        <div className="font-black italic text-2xl tracking-tighter">
          RYLEXA<span className="text-emerald-600">.PM</span>
        </div>
        <div className="flex gap-6 text-sm font-bold text-slate-500">
           <Link href="/login" className="hover:text-slate-900">Sign In</Link>
           <Link href="/apply" className="px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-emerald-600 transition-colors">Apply Now</Link>
        </div>
      </nav>

      {/* PAGE CONTENT */}
      <main className="flex-1">
        {children}
      </main>

      {/* PUBLIC FOOTER */}
      <footer className="p-10 text-center text-slate-400 text-xs font-bold uppercase tracking-widest">
        © 2026 Rylexa Property Management
      </footer>
    </div>
  )
}