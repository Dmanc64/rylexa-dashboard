'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react'
import Image from 'next/image'

// Wrap the page in Suspense because useSearchParams() requires it for static generation
export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-400" size={24} />
      </div>
    }>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    // 1. Authenticate with Supabase Auth
    const { data: { user }, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    })

    if (authError || !user) {
      setError("Invalid credentials. Please try again.")
      setLoading(false)
      return
    }

    // 2. ROUTING LOGIC — Look up role from profiles table (linked via profiles.id → auth.users.id)
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (profileError || !profile) {
      setError("Account not configured. Please contact your administrator.")
      setLoading(false)
      return
    }

    // 3. Route based on role from the profiles table
    // Check if there's a redirect URL from the middleware (e.g. user tried to access /admin directly)
    const redirectTo = searchParams.get('redirect')

    switch (profile.role) {
      case 'Admin':
      case 'Property Manager':
        router.push(redirectTo?.startsWith('/admin') ? redirectTo : '/admin')
        break
      case 'Accounting':
        router.push(redirectTo?.startsWith('/admin/finance') ? redirectTo : '/admin/finance')
        break
      case 'Maintenance':
        router.push(redirectTo?.startsWith('/admin/maintenance') ? redirectTo : '/admin/maintenance')
        break
      case 'Vendor':
        router.push(redirectTo?.startsWith('/vendor-portal') ? redirectTo : '/vendor-portal')
        break
      case 'Owner':
        router.push(redirectTo?.startsWith('/owner-portal') ? redirectTo : '/owner-portal')
        break
      case 'Tenant':
      default:
        router.push(redirectTo?.startsWith('/portal') ? redirectTo : '/portal')
        break
    }

    // Note: We do NOT set loading to false here to prevent the form from flashing back while redirecting.
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-6">

      <div className="mb-8 text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex items-center justify-center gap-2 mb-4">
           <Image src="/icons/rylexa-r.png" alt="Rylexa" width={40} height={40} className="rounded-xl shadow-xl" style={{ height: 'auto' }} />
           <span className="text-2xl font-black italic tracking-tighter text-slate-900">
             RYLEXA<span className="text-emerald-600">.PM</span>
           </span>
        </div>
        <p className="text-slate-400 font-bold text-xs uppercase tracking-widest">
           Secure Access Gateway
        </p>
      </div>

      <div className="w-full max-w-md bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-xl animate-in zoom-in-95 duration-500">

         <div className="mb-8">
            <h1 className="text-2xl font-black text-slate-900 italic uppercase">Welcome Back</h1>
            <p className="text-slate-500 font-medium text-sm mt-2">Enter your credentials to access the system.</p>
         </div>

         <form onSubmit={handleLogin} className="space-y-5">
            <div>
               <label htmlFor="login-email" className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1.5 ml-2">
                 Email Address
               </label>
               <input
                 id="login-email"
                 type="email"
                 value={email}
                 onChange={(e) => setEmail(e.target.value)}
                 required
                 className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-slate-300"
                 placeholder="name@company.com"
               />
            </div>

            <div>
               <label htmlFor="login-password" className="block text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1.5 ml-2">
                 Password
               </label>
               <input
                 id="login-password"
                 type="password"
                 value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 required
                 className="w-full px-5 py-3.5 bg-slate-50 border border-slate-100 rounded-xl font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all placeholder:text-slate-300"
                 placeholder="••••••••••••"
               />
            </div>

            {error && (
               <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3">
                  <AlertCircle className="text-red-500 shrink-0" size={18} />
                  <p className="text-xs font-bold text-red-600">{error}</p>
               </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-slate-900 text-white font-black uppercase tracking-widest text-xs rounded-xl shadow-lg hover:bg-emerald-600 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:hover:scale-100"
            >
               {loading ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
               {loading ? 'Verifying Access...' : 'Sign In To Dashboard'}
            </button>
         </form>

      </div>

      <p className="mt-8 text-center text-slate-400 text-[10px] font-bold uppercase tracking-widest">
         Protected by Rylexa.OS Security
      </p>

    </div>
  )
}
