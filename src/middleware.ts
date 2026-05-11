import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// ────────────────────────────────────────────────────────────────────────────
// ROLE-BASED ACCESS TABLE
//
// Centralizing access rules here so a future role tweak is a one-line edit
// instead of an if-chain edit.
// ────────────────────────────────────────────────────────────────────────────

type Role =
  | 'Admin'
  | 'Property Manager'
  | 'Accounting'
  | 'Maintenance'
  | 'Vendor'
  | 'Tenant'
  | 'Owner'

/**
 * Pages that are Admin-only no matter who is asking.
 * These take precedence over a role's normal scope — even a PM hitting
 * /admin/settings/users gets redirected away.
 *
 * Rationale (from the page-access audit):
 *   - settings/users        → can change other users' roles → privilege escalation
 *   - settings/access*      → grants property access; only admins should
 *   - settings/audit-log    → audit trail is admin-only
 *   - settings/workflows*   → workflow definitions are admin-only
 */
const ADMIN_ONLY_PREFIXES = [
  '/admin/settings/users',
  '/admin/settings/access',         // covers /admin/settings/access AND /admin/settings/access/owners
  '/admin/settings/workflows',      // covers /admin/settings/workflows AND /admin/settings/workflows/[id]
  // /admin/settings/audit-log is NOT admin-only — Accounting needs read access
  // for compliance audits. PMs are explicitly denied via ROLE_DENIES below.
] as const

function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * Per-role DENY list. Pages a role would otherwise reach via their normal
 * scope but should NOT see based on separation-of-duties.
 *
 * Currently used for Property Managers to keep them out of treasury / HR /
 * tax / collections / bookkeeping pages while still allowing the rest of
 * /admin. Their day-to-day P&L, budgets, AP review, statements, and
 * settlements remain accessible.
 */
const ROLE_DENIES: Partial<Record<Role, string[]>> = {
  'Property Manager': [
    '/admin/finance/bank-accounts',   // treasury
    '/admin/finance/payroll',         // HR
    '/admin/payroll',                 // standalone payroll page
    '/admin/finance/tax-forms',       // 1099s
    '/admin/finance/distributions',   // owner payouts — accounting runs
    '/admin/finance/reconcile',       // bank reconciliation
    '/admin/finance/ar-agent',        // collections dept owns this
    '/admin/finance/billing',         // billing config
    '/admin/settings/audit-log',      // sensitive audit history — admin/accounting only
  ],
}

function isDeniedForRole(role: Role, pathname: string): boolean {
  const denies = ROLE_DENIES[role] ?? []
  return denies.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/**
 * Returns true if the role is allowed to *navigate* to this path.
 * Data-level enforcement is handled by RLS via property_access /
 * owner_entity_members, separately.
 *
 * Layered checks in order: ADMIN_ONLY_PREFIXES → ROLE_DENIES → this allow list.
 */
function isAllowedForRole(role: Role, pathname: string): boolean {
  switch (role) {
    case 'Admin':
      // Admin can go anywhere. (Admin-only check above already cleared.)
      return true

    case 'Property Manager':
      // PMs need oversight access into both customer-facing portals.
      return (
        pathname.startsWith('/admin') ||
        pathname.startsWith('/vendor-portal') ||
        pathname.startsWith('/owner-portal')
      )

    case 'Accounting':
      // Tier 1 (legacy) scope: dashboard + financial/AR/leases/vendors.
      // Tier 2 added: properties, tenants, documents, compliance, owners,
      // and the audit log (read-only for compliance audits).
      return (
        pathname === '/admin' ||
        pathname.startsWith('/admin/finance') ||
        pathname.startsWith('/admin/settlements') ||
        pathname.startsWith('/admin/payroll') ||
        pathname.startsWith('/admin/reports') ||
        pathname.startsWith('/admin/leases') ||
        pathname.startsWith('/admin/vendors') ||
        // Tier 2 additions ↓
        pathname.startsWith('/admin/properties') ||
        pathname.startsWith('/admin/tenants') ||
        pathname.startsWith('/admin/documents') ||
        pathname.startsWith('/admin/compliance') ||
        pathname.startsWith('/admin/owners') ||
        pathname.startsWith('/admin/settings/audit-log')
      )

    case 'Maintenance':
      // Tier 1 was locked to /admin/maintenance only.
      // Tier 2 broadens to property context for assigned WOs + coordination
      // pages (messages/notifications) + inspections + documents.
      // Data RLS still scopes everything to their assigned WOs' chain.
      return (
        pathname.startsWith('/admin/maintenance') ||
        pathname.startsWith('/admin/inspections') ||
        pathname.startsWith('/admin/properties') ||   // covers /admin/properties/[id]
        pathname.startsWith('/admin/messages') ||
        pathname.startsWith('/admin/notifications') ||
        pathname.startsWith('/admin/documents')
      )

    case 'Vendor':
      return pathname.startsWith('/vendor-portal')

    case 'Tenant':
      return pathname.startsWith('/portal')

    case 'Owner':
      return pathname.startsWith('/owner-portal')

    default:
      return false
  }
}

/** Default landing page after login, by role. */
function homeForRole(role: Role): string {
  switch (role) {
    case 'Admin':
    case 'Property Manager': return '/admin'
    case 'Accounting':       return '/admin/finance'
    case 'Maintenance':      return '/admin/maintenance'
    case 'Vendor':           return '/vendor-portal'
    case 'Owner':            return '/owner-portal'
    case 'Tenant':           return '/portal'
    default:                 return '/portal'
  }
}


// ────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ────────────────────────────────────────────────────────────────────────────

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: { headers: request.headers },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options })
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options })
          response = NextResponse.next({ request: { headers: request.headers } })
          response.cookies.set({ name, value: '', ...options })
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const pathname = request.nextUrl.pathname
  const isAdminRoute = pathname.startsWith('/admin')
  const isPortalRoute = pathname.startsWith('/portal')
  const isVendorRoute = pathname.startsWith('/vendor-portal')
  const isOwnerRoute = pathname.startsWith('/owner-portal')
  const isLoginRoute = pathname === '/login'
  const isProtectedRoute = isAdminRoute || isPortalRoute || isVendorRoute || isOwnerRoute

  // ── UNAUTHENTICATED USERS ──
  if (!user && isProtectedRoute) {
    const redirectUrl = new URL('/login', request.url)
    redirectUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(redirectUrl)
  }

  // ── AUTHENTICATED USERS ──
  if (user && (isLoginRoute || isProtectedRoute)) {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    // Stale JWT cleanup: profile missing → sign out
    if (profileError || !profile) {
      await supabase.auth.signOut()
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Soft-disable check
    if (!profile.is_active) {
      const redirectUrl = new URL('/login', request.url)
      redirectUrl.searchParams.set('disabled', '1')
      return NextResponse.redirect(redirectUrl)
    }

    const role = profile.role as Role
    const home = homeForRole(role)

    // Login page → bounce to role's home
    if (isLoginRoute) {
      return NextResponse.redirect(new URL(home, request.url))
    }

    // ── ADMIN-ONLY LOCKDOWN (Tier 1) ──
    // Sensitive settings pages — even PMs and Accounting are blocked here.
    if (isAdminOnlyPath(pathname) && role !== 'Admin') {
      return NextResponse.redirect(new URL(home, request.url))
    }

    // ── PER-ROLE DENY CHECK (Tier 2 — separation of duties) ──
    // Pages a role's general scope would allow, but specific responsibilities
    // exclude (e.g. PMs can hit /admin but not /admin/finance/payroll).
    if (isDeniedForRole(role, pathname)) {
      return NextResponse.redirect(new URL(home, request.url))
    }

    // ── ROLE SCOPE CHECK ──
    if (!isAllowedForRole(role, pathname)) {
      return NextResponse.redirect(new URL(home, request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico
     * - public files (images, etc)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
